/* =====================================================================
   Checkout Crypto — page d'administration (admin.html)
   ---------------------------------------------------------------------
   Sans serveur, sans mot de passe : la lecture est publique, et toute
   écriture est signée par le wallet propriétaire du contrat.
   Robustesse : timeout par appel + bascule automatique entre RPC publics.
   ===================================================================== */
(function () {
  'use strict';

  var cfg = window.CHECKOUT_CONFIG || {};
  var USDT = cfg.usdt || {};
  var ABI = [
    'function owner() view returns (address)',
    'function payout() view returns (address)',
    'function products(string) view returns (uint256 price, bool exists)',
    'function productPriceInToken(string, address) view returns (uint256)',
    'function setProductPrice(string, uint256)',
    'function setProductPriceInToken(string, address, uint256)',
    'function withdraw(uint256)',
    'function setPayout(address)'
  ];

  var $ = function (id) { return document.getElementById(id); };

  var sig = null;       // signer connecté
  var user = null;      // adresse du wallet connecté
  var ownerAddr = null; // propriétaire du contrat
  var isOwner = false;
  var isV2 = false;
  var usdtDecimals = USDT.decimals || 18;

  function setStatus(msg, cls, asHtml) {
    var el = $('status');
    if (asHtml === true) { el.innerHTML = msg; } else { el.textContent = msg || ''; }
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function errMsg(e) {
    return (e && (e.shortMessage || e.reason || e.message)) || 'Erreur inconnue';
  }

  function fmt(v) {
    var s = ethers.formatEther(v);
    if (s.indexOf('.') >= 0) { s = s.replace(/0+$/, '').replace(/\.$/, ''); }
    return s;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // ------------------- lecture (sans wallet) -------------------
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

  async function rpc(fn) {
    var list = cfg.readRpcs || [];
    var last = null;
    for (var k = 0; k <= list.length; k++) {
      try {
        var p = await getReadProvider();
        var c = new ethers.Contract(cfg.contract, ABI, p);
        return await withTimeout(fn(c), 9000);
      } catch (e) {
        last = e;
        if (e && (e.code === 'CALL_EXCEPTION' || e.code === 'BAD_DATA')) throw e;
        readProvider = null;
        rpcIndex = (rpcIndex + 1) % (list.length || 1);
      }
    }
    throw last || new Error('RPC indisponible');
  }

  async function refresh() {
    setStatus('Lecture du contrat…');
    var fails = 0;
    try {
      ownerAddr = await rpc(function (c) { return c.owner(); }).catch(function () { return null; });
      var payout = await rpc(function (c) { return c.payout(); }).catch(function () { return null; });
      isV2 = !!(payout && /^0x[a-fA-F0-9]{40}$/.test(payout));
      if (isV2) { $('payout').textContent = payout; }

      var bal = await rpc(function (c) { return (c.runner.provider || c.runner).getBalance(cfg.contract); })
        .catch(function () { return null; });
      $('balance').textContent = bal === null ? '— (lecture impossible)' : fmt(bal) + ' BNB';

      var ids = Object.keys(cfg.products || {});
      var box = $('products');
      box.innerHTML = '';
      for (var i = 0; i < ids.length; i++) {
        var ok = await renderProduct(box, ids[i]);
        if (!ok) { fails++; }
      }

      $('sec-v2').classList.toggle('hide', !isV2);
      syncButtons();
      var msg = ownerAddr
        ? 'Propriétaire du contrat : ' + ownerAddr + (isV2 ? ' — CheckoutV2 détecté ✓' : ' — contrat V1 (BNB uniquement)')
        : 'Propriétaire inconnu (lecture seule).';
      if (fails) { msg += ' · ' + fails + ' lecture(s) produit en échec — clique ↻ Recharger.'; }
      setStatus(msg, fails ? 'err' : '');
    } catch (e) {
      setStatus('Erreur de lecture : ' + errMsg(e) + ' — clique ↻ Recharger.', 'err');
    }
  }

  // Retourne true si la lecture on-chain a réussi, sinon affiche l'erreur.
  async function renderProduct(box, id) {
    var meta = (cfg.products && cfg.products[id]) || {};
    var pr = null;
    var ok = true;
    try { pr = await rpc(function (c) { return c.products(id); }); } catch (e) { ok = false; }
    var usd = null;
    if (ok && isV2 && USDT.enabled && USDT.address) {
      usd = await rpc(function (c) { return c.productPriceInToken(id, USDT.address); }).catch(function () { return null; });
    }

    var exists = pr ? pr[1] : false;
    var info;
    if (!ok) { info = '<span class="err">lecture impossible — réessaie (↻)</span>'; }
    else if (exists) {
      info = 'actuel : <b>' + fmt(pr[0]) + ' BNB</b>' + (usd !== null ? ' · <b>' + fmt(usd) + ' USDT</b>' : '');
    } else { info = '<span class="muted">pas encore enregistré on-chain</span>'; }

    var div = document.createElement('div');
    div.className = 'prod';

    var head = document.createElement('div');
    head.className = 'prod-head';
    head.innerHTML = '<b>' + esc(id) + '</b> <span class="muted">' + esc(meta.name || '') + '</span> — ' + info;
    div.appendChild(head);

    var row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      '<input class="in" data-kind="bnb" placeholder="nouveau prix BNB">' +
      '<button class="go" data-id="' + esc(id) + '" data-kind="bnb" disabled>Définir</button>' +
      (isV2 && USDT.enabled && USDT.address
        ? '<input class="in" data-kind="usdt" placeholder="nouveau prix USDT">' +
          '<button class="go" data-id="' + esc(id) + '" data-kind="usdt" disabled>Définir USDT</button>'
        : '');
    div.appendChild(row);
    box.appendChild(div);
    return ok;
  }

  // ------------------- actions (owner) -------------------
  function syncButtons() {
    var els = document.querySelectorAll('.go, #add, #withdraw, #set-payout');
    for (var i = 0; i < els.length; i++) { els[i].disabled = !isOwner; }
  }

  function validateAmount(val) {
    if (!val || isNaN(Number(val)) || Number(val) <= 0) { return null; }
    return val;
  }

  async function doSet(id, kind, val) {
    var c = new ethers.Contract(cfg.contract, ABI, sig);
    var tx;
    if (kind === 'bnb') {
      tx = await c.setProductPrice(id, ethers.parseEther(val));
    } else {
      tx = await c.setProductPriceInToken(id, USDT.address, ethers.parseUnits(val, usdtDecimals));
    }
    setStatus('Transaction envoyée, en attente de confirmation… ' +
      '<a href="' + cfg.chain.explorer + '/tx/' + tx.hash + '" target="_blank" rel="noopener">voir</a>', '', true);
    await tx.wait();
    setStatus('✓ Prix mis à jour : ' + id + ' = ' + val + ' ' + (kind === 'bnb' ? 'BNB' : 'USDT'), 'ok');
    await refresh();
  }

  async function onProductClick(ev) {
    var b = (ev.target && ev.target.closest) ? ev.target.closest('button.go') : null;
    if (!b) return;
    if (!isOwner || !sig) { setStatus("Connecte d'abord le wallet propriétaire.", 'err'); return; }
    var input = b.previousElementSibling;
    var val = ((input && input.value) || '').trim().replace(',', '.');
    if (!validateAmount(val)) { setStatus('Montant invalide.', 'err'); return; }
    try {
      b.disabled = true;
      await doSet(b.getAttribute('data-id'), b.getAttribute('data-kind'), val);
    } catch (e) {
      setStatus('Erreur : ' + errMsg(e), 'err');
    } finally {
      syncButtons();
    }
  }

  async function onAdd() {
    if (!isOwner || !sig) { setStatus("Connecte d'abord le wallet propriétaire.", 'err'); return; }
    var id = ($('new-id').value || '').trim();
    var val = ($('new-price').value || '').trim().replace(',', '.');
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(id)) { setStatus('Identifiant invalide (lettres, chiffres, . - _ ; 2 à 40 caractères).', 'err'); return; }
    if (!validateAmount(val)) { setStatus('Prix BNB invalide.', 'err'); return; }
    try {
      $('add').disabled = true;
      await doSet(id, 'bnb', val);
      if (!cfg.products[id]) { cfg.products[id] = { name: '', description: '' }; }
      $('new-id').value = ''; $('new-price').value = '';
    } catch (e) {
      setStatus('Erreur : ' + errMsg(e), 'err');
    } finally {
      syncButtons();
    }
  }

  async function onWithdraw() {
    if (!isOwner || !sig) { setStatus("Connecte d'abord le wallet propriétaire.", 'err'); return; }
    try {
      $('withdraw').disabled = true;
      var bal = await rpc(function (c) { return (c.runner.provider || c.runner).getBalance(cfg.contract); });
      if (bal <= 0) { setStatus('Rien à retirer (solde du contrat : 0 BNB).'); return; }
      var c = new ethers.Contract(cfg.contract, ABI, sig);
      var tx = await c.withdraw(bal);
      setStatus('Retrait envoyé, en attente… ' +
        '<a href="' + cfg.chain.explorer + '/tx/' + tx.hash + '" target="_blank" rel="noopener">voir</a>', '', true);
      await tx.wait();
      setStatus('✓ Retrait effectué (' + fmt(bal) + ' BNB).', 'ok');
      await refresh();
    } catch (e) {
      setStatus('Erreur : ' + errMsg(e), 'err');
    } finally {
      syncButtons();
    }
  }

  async function onSetPayout() {
    if (!isOwner || !sig) { setStatus("Connecte d'abord le wallet propriétaire.", 'err'); return; }
    var addr = ($('new-payout').value || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) { setStatus('Adresse invalide.', 'err'); return; }
    try {
      $('set-payout').disabled = true;
      var c = new ethers.Contract(cfg.contract, ABI, sig);
      var tx = await c.setPayout(addr);
      setStatus('Changement envoyé, en attente… ' +
        '<a href="' + cfg.chain.explorer + '/tx/' + tx.hash + '" target="_blank" rel="noopener">voir</a>', '', true);
      await tx.wait();
      setStatus('✓ Adresse de retrait mise à jour : ' + addr, 'ok');
      $('new-payout').value = '';
      await refresh();
    } catch (e) {
      setStatus('Erreur : ' + errMsg(e), 'err');
    } finally {
      syncButtons();
    }
  }

  async function connect() {
    if (typeof window.ethereum === 'undefined') {
      setStatus('Aucun wallet détecté. Installe MetaMask pour administrer le contrat.', 'err');
      return;
    }
    try {
      var bp = new ethers.BrowserProvider(window.ethereum);
      await bp.send('eth_requestAccounts', []);
      sig = await bp.getSigner();
      user = await sig.getAddress();
      if (!ownerAddr) {
        ownerAddr = await rpc(function (c) { return c.owner(); }).catch(function () { return null; });
      }
      isOwner = !!(ownerAddr && user.toLowerCase() === ownerAddr.toLowerCase());
      $('who').textContent = 'Wallet : ' + user + (isOwner ? ' — PROPRIÉTAIRE ✓' : ' — pas le propriétaire (lecture seule)');
      $('who').className = 'muted' + (isOwner ? ' ok' : '');
      $('connect').textContent = 'Changer de wallet';
      syncButtons();
      setStatus(isOwner ? 'Wallet propriétaire connecté — tu peux modifier.' :
        "Ce wallet n'est pas le propriétaire du contrat : actions désactivées.", isOwner ? 'ok' : 'err');
    } catch (e) {
      setStatus('Erreur de connexion : ' + errMsg(e), 'err');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('connect').addEventListener('click', connect);
    $('reload').addEventListener('click', function () { refresh(); });
    $('add').addEventListener('click', onAdd);
    $('withdraw').addEventListener('click', onWithdraw);
    $('set-payout').addEventListener('click', onSetPayout);
    $('products').addEventListener('click', onProductClick);
    refresh();
  });
})();
