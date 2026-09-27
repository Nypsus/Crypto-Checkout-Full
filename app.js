/* =====================================================================
   Checkout Crypto — logique de la page  (version FULL / R&D)
   ---------------------------------------------------------------------
   Zéro saisie côté acheteur : le produit arrive par le lien (?product=…),
   le montant et l'adresse de destination viennent du contrat.
   Briques en plus vs la prod : QR « payer depuis le téléphone » et
   lien de livraison vérifiée on-chain (delivery.html).
   ===================================================================== */
(function () {
  'use strict';

  var cfg = window.CHECKOUT_CONFIG || {};
  var ZERO = '0x0000000000000000000000000000000000000000';

  var CHECKOUT_ABI = [
    'function products(string) view returns (uint256 price, bool exists)',
    'function productPriceInToken(string, address) view returns (uint256)',
    'function pay(address token, uint256 amount, string productId) payable'
  ];
  var ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)',
    'function approve(address, uint256) returns (bool)'
  ];

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var productId = (params.get('product') || '').trim();

  var state = { product: null, unit: 'BNB', rates: { bnb: null, usdt: null } };

  // ---------------- petits helpers ----------------
  function setStatus(msg, cls) {
    var el = $('status'); el.textContent = msg || ''; el.className = 'status' + (cls ? ' ' + cls : '');
  }
  function setStatusHTML(msg, cls) {
    var el = $('status'); el.innerHTML = msg || ''; el.className = 'status' + (cls ? ' ' + cls : '');
  }
  function show(id) {
    ['view-loading', 'view-list', 'view-product', 'view-success'].forEach(function (v) {
      $(v).classList.toggle('hide', v !== id);
    });
  }
  function short(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
  function explorerTx(h) { return cfg.chain.explorer + '/tx/' + h; }
  function explorerAddr(a) { return cfg.chain.explorer + '/address/' + a; }
  function txLink(hash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) return '';
    return ' <a href="' + explorerTx(hash) + '" target="_blank" rel="noopener">voir sur BscScan</a>';
  }
  function fmt(v) {
    var s = ethers.formatUnits(v, 18);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  // ---------------- lecture blockchain (sans wallet) ----------------
  // Robustesse : chaque appel a un timeout, et en cas de lenteur/erreur
  // réseau on bascule automatiquement sur un autre RPC public.
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

  // Exécute fn(contrat) en essayant les RPC dans l'ordre (timeout par essai).
  // Les erreurs « métier » (revert / réponse invalide) ne tournent pas en boucle.
  async function rpc(fn) {
    var list = cfg.readRpcs || [];
    var last = null;
    for (var k = 0; k <= list.length; k++) {
      try {
        var p = await getReadProvider();
        var c = new ethers.Contract(cfg.contract, CHECKOUT_ABI, p);
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

  async function readProduct(id) {
    var r = await rpc(function (c) { return c.products(id); });
    var out = { exists: r[1], priceBNB: r[0], priceUSDT: 0n, usdtSupported: false };
    if (out.exists && cfg.usdt && cfg.usdt.enabled) {
      try {
        var u = await rpc(function (c) { return c.productPriceInToken(id, cfg.usdt.address); });
        out.priceUSDT = u;
        out.usdtSupported = u > 0n;
      } catch (e) { out.usdtSupported = false; }
    }
    return out;
  }

  async function getRates() {
    if (!cfg.showUsdEstimate) return;
    try {
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, 6000);
      var res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,tether&vs_currencies=usd', { signal: ctrl.signal });
      clearTimeout(t);
      var j = await res.json();
      state.rates.bnb = (j.binancecoin && j.binancecoin.usd) || null;
      state.rates.usdt = (j.tether && j.tether.usd) || null;
    } catch (e) { /* estimation seulement : on ignore */ }
  }

  // ---------------- QR « payer depuis le téléphone » ----------------
  // Affiché sur desktop seulement : encode l'URL de cette page.
  // Le scan ouvre ce checkout sur le téléphone — montant et adresse
  // restent remplis par le contrat, rien à saisir.
  function renderQr() {
    if (isMobile()) return;
    var box = $('qr-box');
    if (!box) return;
    try {
      var el = $('qr-canvas');
      el.innerHTML = '';
      new QRCode(el, { text: location.href, width: 136, height: 136, correctLevel: QRCode.CorrectLevel.M });
      box.classList.remove('hide');
    } catch (e) {
      box.classList.add('hide'); // lib CDN indisponible : on masque simplement le bloc
    }
  }

  // ---------------- affichage ----------------
  function updatePrices() {
    var pr = state.product;
    if (!pr || !pr.exists) return;
    var isUSDT = state.unit === 'USDT';
    var amount = isUSDT ? pr.priceUSDT : pr.priceBNB;
    $('p-price').textContent = fmt(amount);
    $('p-unit').textContent = isUSDT ? (cfg.usdt.symbol || 'USDT') : 'BNB';
    var usd = null;
    if (cfg.showUsdEstimate && state.rates.bnb) {
      if (isUSDT) { if (state.rates.usdt) usd = Number(fmt(amount)) * state.rates.usdt; }
      else usd = Number(fmt(amount)) * state.rates.bnb;
    }
    $('p-usd').textContent = usd ? ('≈ ' + usd.toFixed(2) + ' $') : '';
    $('pay').textContent = 'Payer ' + fmt(amount) + ' ' + (isUSDT ? (cfg.usdt.symbol || 'USDT') : 'BNB');
    $('pay').disabled = false;
  }

  // ---------------- wallet ----------------
  function isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function hasWallet() { return typeof window.ethereum !== 'undefined'; }
  function openInWallet() {
    var url = location.host + location.pathname + location.search;
    location.href = 'https://metamask.app.link/dapp/' + url;
  }

  async function connectAccounts() {
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
    } catch (e) {
      await window.ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
      await window.ethereum.request({ method: 'eth_requestAccounts' });
    }
  }

  async function ensureChain() {
    var eth = window.ethereum;
    var cur = await eth.request({ method: 'eth_chainId' });
    if (String(cur).toLowerCase() === cfg.chain.hexId.toLowerCase()) return;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chain.hexId }] });
    } catch (e) {
      if (e && (e.code === 4902 || e.code === -32603)) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: cfg.chain.hexId,
            chainName: cfg.chain.name,
            nativeCurrency: cfg.chain.nativeCurrency,
            rpcUrls: cfg.chain.rpcUrls,
            blockExplorerUrls: [cfg.chain.explorer]
          }]
        });
      } else { throw e; }
    }
  }

  // ---------------- paiement ----------------
  async function pay() {
    var pr = state.product;
    if (!pr || !pr.exists) return;

    if (!hasWallet()) {
      if (isMobile()) { setStatus('Ouverture de MetaMask…'); openInWallet(); }
      else { setStatus('Aucun wallet détecté. Installe MetaMask pour payer (il te suffira de confirmer).', 'err'); }
      return;
    }

    $('pay').disabled = true;
    try {
      await connectAccounts();
      await ensureChain();

      var bp = new ethers.BrowserProvider(window.ethereum);
      var signer = await bp.getSigner();
      var user = await signer.getAddress();
      var c = new ethers.Contract(cfg.contract, CHECKOUT_ABI, signer);

      if (state.unit === 'BNB') {
        var bal = await bp.getBalance(user);
        if (bal < pr.priceBNB) {
          throw new Error('Solde BNB insuffisant (garde un peu de BNB pour les frais de réseau).');
        }
        setStatus('Confirme la transaction dans ton wallet…');
        var tx = await c.pay(ZERO, pr.priceBNB, productId, { value: pr.priceBNB });
        setStatusHTML('Transaction envoyée, en attente de confirmation…' + txLink(tx.hash));
        await tx.wait();
        success(tx.hash);

      } else {
        var token = new ethers.Contract(cfg.usdt.address, ERC20_ABI, signer);
        var tbal = await token.balanceOf(user);
        if (tbal < pr.priceUSDT) throw new Error('Solde ' + (cfg.usdt.symbol || 'USDT') + ' insuffisant.');

        var allow = await token.allowance(user, cfg.contract);
        if (allow < pr.priceUSDT) {
          setStatus('Étape 1/2 — dans ton wallet, autorise le montant exact…');
          var atx = await token.approve(cfg.contract, pr.priceUSDT);
          setStatusHTML('Approbation envoyée (1/2), en attente de confirmation…' + txLink(atx.hash));
          await atx.wait();
        }
        setStatus('Étape 2/2 — confirme le paiement dans ton wallet…');
        var ptx = await c.pay(cfg.usdt.address, pr.priceUSDT, productId, { value: 0n });
        setStatusHTML('Transaction envoyée, en attente de confirmation…' + txLink(ptx.hash));
        await ptx.wait();
        success(ptx.hash);
      }
    } catch (e) {
      var msg = (e && (e.shortMessage || e.reason || e.message)) || 'Erreur inattendue';
      if ((e && e.code === 4001) || /user rejected|rejected by user|annul/i.test(msg)) msg = 'Transaction annulée.';
      setStatus(msg, 'err');
      $('pay').disabled = false;
      updatePrices();
    }
  }

  function success(hash) {
    $('ok-tx').href = explorerTx(hash);
    $('ok-tx').textContent = 'Voir la transaction sur BscScan (' + short(hash) + ')';
    var red = params.get('redirect') || cfg.successRedirect;
    var ref = params.get('ref');
    var dl = $('ok-delivery');
    if (red) {
      // On transmet le hash de transaction à la page de destination :
      // si c'est notre page de livraison (ou la tienne), elle peut vérifier.
      if (red.indexOf('tx=') === -1) red += (red.indexOf('?') >= 0 ? '&' : '?') + 'tx=' + hash;
      if (ref) red += (red.indexOf('?') >= 0 ? '&' : '?') + 'ref=' + encodeURIComponent(ref);
      $('ok-redirect').textContent = 'Redirection vers la livraison dans quelques secondes…';
      setTimeout(function () { location.href = red; }, 2500);
      if (dl) dl.classList.add('hide');
    } else {
      if (dl) {
        dl.href = 'delivery.html?product=' + encodeURIComponent(productId) + '&tx=' + hash;
        dl.classList.remove('hide');
      }
      $('ok-redirect').textContent = '';
    }
    show('view-success');
  }

  // ---------------- liste des produits (sans ?product=) ----------------
  function showList() {
    var list = $('product-list');
    list.innerHTML = '';
    var ids = Object.keys(cfg.products || {});
    if (!ids.length) {
      var p = document.createElement('p');
      p.className = 'desc';
      p.textContent = 'Aucun produit configuré.';
      list.appendChild(p);
      show('view-list');
      return;
    }
    ids.forEach(function (id) {
      var meta = cfg.products[id] || {};
      var b = document.createElement('button');
      b.textContent = meta.name || id;
      b.addEventListener('click', function () {
        var q = new URLSearchParams(location.search);
        q.set('product', id);
        location.search = q.toString();
      });
      list.appendChild(b);
    });
    show('view-list');
  }

  // ---------------- init ----------------
  async function init() {
    if (!cfg.contract || !cfg.chain) {
      show('view-loading');
      $('view-loading').textContent = 'Configuration manquante (config.js).';
      return;
    }
    $('brand').textContent = cfg.brand || 'Paiement crypto';
    document.title = cfg.brand || 'Paiement crypto';
    $('chip').textContent = cfg.chain.name;
    $('contract-link').href = explorerAddr(cfg.contract);
    $('contract-link').textContent = short(cfg.contract);

    if (!productId) { showList(); return; }

    var meta = (cfg.products && cfg.products[productId]) || {};
    show('view-loading');
    try {
      var pr = await readProduct(productId);
      state.product = pr;
      $('p-name').textContent = meta.name || productId;
      $('p-desc').textContent = meta.description || '';

      if (!pr.exists) {
        show('view-product');
        $('p-price').textContent = '—';
        $('pay').disabled = true;
        setStatus('Ce produit n’existe pas (ou plus) dans le contrat.', 'err');
        return;
      }

      var bu = $('btn-usdt');
      if (pr.usdtSupported) { bu.disabled = false; bu.title = ''; }
      else { bu.disabled = true; bu.title = 'Prix USDT non réglé pour ce produit.'; }

      show('view-product');
      updatePrices();
      getRates().then(updatePrices);
      renderQr();

    } catch (e) {
      show('view-product');
      $('p-name').textContent = meta.name || productId;
      $('p-desc').textContent = meta.description || '';
      setStatus('Impossible de lire le produit sur la blockchain. Réessaie dans un instant.', 'err');
    }
  }

  // ---------------- events ----------------
  $('btn-bnb').addEventListener('click', function () {
    state.unit = 'BNB';
    this.classList.add('on'); $('btn-usdt').classList.remove('on');
    updatePrices();
  });
  $('btn-usdt').addEventListener('click', function () {
    if (this.disabled) return;
    state.unit = 'USDT';
    this.classList.add('on'); $('btn-bnb').classList.remove('on');
    updatePrices();
  });
  $('pay').addEventListener('click', pay);

  init();
})();
