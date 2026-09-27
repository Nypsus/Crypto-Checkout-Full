/* =====================================================================
   Checkout Crypto — Configuration  (version FULL / R&D)
   ---------------------------------------------------------------------
   Variante complète du système : QR « payer depuis le téléphone »,
   livraison vérifiée on-chain, USDT dès que CheckoutV2 est déployé.
   La version stable reste Crypto-Checkout (prod) — rien n'y est touché.
   Le PRIX affiché et payé vient TOUJOURS du contrat (jamais d'ici).
   ===================================================================== */
window.CHECKOUT_CONFIG = {

  // ---- Marque / affichage ----
  brand: 'Paiement crypto',

  // ---- Réseau ----
  chain: {
    id: 56,                                            // BNB Smart Chain mainnet
    hexId: '0x38',
    name: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-dataseed.binance.org/'],
    explorer: 'https://bscscan.com'
  },

  // RPC publics pour lire le contrat SANS wallet.
  // Essais dans l'ordre, bascule automatique en cas de lenteur/erreur
  // (timeout de 9 s par appel).
  readRpcs: [
    'https://bsc-rpc.publicnode.com',
    'https://bsc-dataseed.binance.org/',
    'https://rpc.ankr.com/bsc'
  ],

  // ---- Contrat de paiement ----
  // V1 actuel (BNB uniquement) : 0xCd25eee89Bb01603f0E0cf8D8C243966a926761d
  // V2 (prix par devise + payout configurable) : à déployer (contract/CheckoutV2.sol).
  contract: '0xCd25eee89Bb01603f0E0cf8D8C243966a926761d',
  nativeToken: '0x0000000000000000000000000000000000000000', // adresse 0 = BNB dans pay()

  // ---- Paiement en USDT (stablecoin) ----
  // L'option USDT ne s'affiche automatiquement QUE si le contrat renvoie un
  // prix USDT pour le produit (contrat CheckoutV2 — voir README).
  usdt: {
    enabled: true,
    address: '0x55d398326f99059fF775485246999027B3197955', // Binance-Peg USDT (BSC, 18 décimales)
    symbol: 'USDT',
    decimals: 18
  },

  // ---- Produits (métadonnées affichées) ----
  // La clé = le productId enregistré dans le contrat (setProductPrice).
  // deliveryUrl  : lien révélé par delivery.html après paiement VÉRIFIÉ
  //                on-chain (la page de contenu / d'accès).
  // deliveryText : alternative en texte (code d'accès, instructions…).
  products: {
    product1: { name: 'Indicateur Daily',  description: 'Accès à l’indicateur Daily — Les Indicateurs à Levier', deliveryUrl: 'https://nypsus.github.io/Front-end-indicateur/Delivrance_IndicateurD.html', deliveryText: '' },
    product2: { name: 'Indicateur 4h/1h',  description: 'Accès à l’indicateur 4h/1h — Les Indicateurs à Levier', deliveryUrl: '', deliveryText: '' },
    product3: { name: 'Indicateur 15mn',   description: 'Accès à l’indicateur 15mn — Les Indicateurs à Levier',  deliveryUrl: '', deliveryText: '' }
  },

  // ---- Options d'affichage ----
  showUsdEstimate: true,   // estimation en $ au taux CoinGecko (affichage seulement)
  successRedirect: null    // URL de redirection après paiement réussi.
                           // null = écran de succès + lien « livraison vérifiée »
                           // (surchargeable par le lien : ?redirect=https://...)
};
