/* =====================================================================
   Livraison vérifiée on-chain  (version FULL / R&D)
   ---------------------------------------------------------------------
   Lit ?product=…&tx=0x… — vérifie sur la blockchain que cette transaction
   contient bien un événement PaymentReceived de NOTRE contrat pour CE
   produit — puis révèle le contenu de livraison (config.js).
   Aucun serveur : la vérification est faite directement contre le réseau.
   ===================================================================== */
(function () {
  'use strict';

  var cfg = window.CHECKOUT_CONFIG || {};
  var EVENT_ABI = ['event PaymentReceived(address indexed user, uint256 amount, address token, string productId)'];

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var productId = (params.get('product') || '').trim();
  var txHash = (params.get('tx') || '').trim();

  // ---------------- lecture blockchain (sans wallet) ----------------
  var readProvider = null;
  var rpcIndex = 0;

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(
        function (v) { clearTimeout(t); resolve(v); },
        function (e) { clearTimeout(t); reject(e); }
      );
    });
  }

  async function getReadProvider() {
    if (readProvider) return readProvider;
    var list = cfg.readRpcs || [];
    var last = null;
    for (var k = 0; k < list.length; k++) {
      var i = (rpcIndex + k) % list.length;
      try {
        var p = new ethers.JsonRpcProvider(list[i], cfg.chain.id, { staticNetwork: true });
        await withTimeout(p.getBlockNumber(), 6000);
        rpcIndex = i;
        readProvider = p;
        return p;
      } catch (e) { last = e; }
    }
    throw last || new Error('Aucun RPC disponible');
  }

  // Exécute fn(provider) en essayant les RPC dans l'ordre (timeout par essai).
  async function rpc(fn) {
    var list = cfg.readRpcs || [];
    var last = null;
    for (var k = 0; k <= list.length; k++) {
      try {
        var p = await getReadProvider();
        return await withTimeout(fn(p), 9000);
      } catch (e) {
        last = e;
        if (e && (e.code === 'CALL_EXCEPTION' || e.code === 'BAD_DATA')) throw e;
        readProvider = null;
        rpcIndex = (rpcIndex + 1) % (list.length || 1);
      }
    }
    throw last || new Error('RPC indisponible');
  }

  // ---------------- helpers ----------------
  function short(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
  function explorerTx(h) { return cfg.chain.explorer + '/tx/' + h; }
  function fmtAmount(v) {
    var s = ethers.formatUnits(v, 18);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  function tokenSymbol(token) {
    if (String(token).toLowerCase() === '0x0000000000000000000000000000000000000000') return 'BNB';
    if (cfg.usdt && String(token).toLowerCase() === String(cfg.usdt.address).toLowerCase()) return cfg.usdt.symbol || 'USDT';
    return 'jeton';
  }
  function fail(msg) {
    $('st-loading').classList.add('hide');
    $('st-ok').classList.add('hide');
    $('fail-msg').textContent = msg;
    $('st-fail').classList.remove('hide');
  }

  // ---------------- vérification ----------------
  async function verify() {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return fail('Lien de livraison invalide : numéro de transaction manquant ou mal formé.');
    }

    var receipt;
    try {
      receipt = await rpc(function (p) { return p.getTransactionReceipt(txHash); });
    } catch (e) {
      return fail('Impossible de lire la blockchain pour le moment. Réessaie dans un instant.');
    }
    if (!receipt) {
      return fail('Transaction introuvable sur la blockchain. Vérifie le lien — ou attends quelques secondes si tu viens de payer.');
    }
    if (Number(receipt.status) !== 1) {
      return fail('La transaction a échoué on-chain : aucun paiement valide.');
    }

    var iface = new ethers.Interface(EVENT_ABI);
    var found = null;
    for (var i = 0; i < receipt.logs.length; i++) {
      var lg = receipt.logs[i];
      if (String(lg.address).toLowerCase() !== String(cfg.contract).toLowerCase()) continue;
      try {
        var parsed = iface.parseLog({ topics: lg.topics.slice(), data: lg.data });
        if (parsed && parsed.name === 'PaymentReceived') { found = parsed; break; }
      } catch (e) { /* log d'un autre type : on ignore */ }
    }
    if (!found) {
      return fail('Cette transaction ne contient aucun paiement de notre contrat.');
    }

    var payer = found.args[0];
    var amount = found.args[1];
    var token = found.args[2];
    var pid = found.args[3];

    if (productId && pid !== productId) {
      return fail('Ce paiement correspond à un autre produit (« ' + pid + ' »). Ouvre ta livraison depuis le lien de ton achat.');
    }

    // ---- OK : on affiche ----
    var meta = (cfg.products && cfg.products[pid]) || {};
    $('ok-sum').innerHTML =
      '<strong>' + (meta.name || pid) + '</strong> — ' + fmtAmount(amount) + ' ' + tokenSymbol(token) +
      '<br>Payé par ' + short(payer) +
      ' · <a href="' + explorerTx(txHash) + '" target="_blank" rel="noopener">transaction vérifiée sur BscScan</a>';

    var box = $('ok-deliver');
    box.innerHTML = '';
    if (meta.deliveryUrl) {
      var a = document.createElement('a');
      a.href = meta.deliveryUrl;
      a.className = 'ok-link';
      a.textContent = 'Accéder à mon accès →';
      box.appendChild(a);
    } else if (meta.deliveryText) {
      var p = document.createElement('p');
      p.className = 'desc';
      p.textContent = meta.deliveryText;
      box.appendChild(p);
    } else {
      var p2 = document.createElement('p');
      p2.className = 'desc';
      p2.textContent = 'Paiement valide ✓ — (contenu de livraison à renseigner dans config.js : deliveryUrl ou deliveryText du produit « ' + pid + ' »)';
      box.appendChild(p2);
    }

    // Contrôle renforcé : si un wallet est présent, comparer au payeur.
    var bw = $('btn-wallet');
    if (typeof window.ethereum !== 'undefined') {
      bw.classList.remove('hide');
      bw.onclick = async function () {
        try {
          var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          var me = accounts && accounts[0];
          var el = $('ok-walletcheck');
          if (me && String(me).toLowerCase() === String(payer).toLowerCase()) {
            el.textContent = '✓ Le wallet connecté est bien celui qui a payé.';
            el.className = 'status ok';
          } else {
            el.textContent = '⚠️ Le wallet connecté (' + short(me) + ') n’est pas celui qui a payé (' + short(payer) + ').';
            el.className = 'status err';
          }
        } catch (e) {
          $('ok-walletcheck').textContent = 'Connexion wallet annulée.';
          $('ok-walletcheck').className = 'status';
        }
      };
    }

    $('st-loading').classList.add('hide');
    $('st-fail').classList.add('hide');
    $('st-ok').classList.remove('hide');
  }

  // ---------------- init ----------------
  $('brand').textContent = cfg.brand || 'Paiement crypto';
  if (cfg.chain && cfg.contract) {
    $('contract-link').href = cfg.chain.explorer + '/address/' + cfg.contract;
    $('contract-link').textContent = short(cfg.contract);
  }
  verify();
})();
