# Crypto-Checkout-Full — le système de paiement complet (labo)

Variante **complète / R&D** du système de paiement crypto non-custodial.
La version stable (celle déjà en ligne) reste **Crypto-Checkout** — ici on
construit les briques « full » sans toucher à la prod.

## Ce qu'il y a en plus vs Crypto-Checkout

| Brique | État | Détail |
|---|---|---|
| Base checkout (BNB, zéro saisie) | ✅ | copie de la prod, mêmes RPC publics + rotation + timeout 9 s |
| **QR « payer depuis le téléphone »** | ✅ | affiché sur desktop, encode l'URL de la page — le scan ouvre le checkout mobile |
| **Livraison vérifiée on-chain** | ✅ | `delivery.html?product=…&tx=0x…` vérifie l'event `PaymentReceived` du contrat avant d'afficher l'accès |
| **USDT** | ⏳ prêt | s'active tout seul dès que `contract/CheckoutV2.sol` est déployé et l'adresse mise dans `config.js` |
| Multi-chaînes EVM | 🔜 roadmap | 1 contrat par réseau (Ethereum, Polygon…), même checkout |
| BTC / SOL natifs | ❌ hors scope | exigerait des serveurs de polling (l'ancien essai QR) — pas nécessaire |

Hors scope assumé également : **mixeurs / anonymisation des flux** — illégal
dans de nombreuses juridictions, risque pénal + gel des conversions fiat ;
et inutile pour l'objectif (aucune plateforme tierce ne détient les flux).

## Comment ça marche (acheteur)

1. Lien du type `index.html?product=product2` (ou QR scanné depuis le téléphone).
2. Le montant et l'adresse viennent **du contrat** — jamais saisis à la main.
3. Paiement par wallet (MetaMask…) → transaction vers le contrat.
4. Sur l'écran de succès : lien **« Accéder à ma livraison »** →
   `delivery.html` vérifie la transaction on-chain et révèle l'accès.

## Configuration

Tout est dans `config.js` :

- `contract` : adresse du contrat (V1 aujourd'hui, V2 après déploiement).
- `readRpcs` : RPC publics de lecture (rotation automatique).
- `products.<id>.deliveryUrl` / `deliveryText` : ce qui est révélé après
  paiement vérifié (`deliveryUrl` = lien vers ta page d'accès ; `deliveryText`
  = code/instructions en texte).
- `successRedirect` : redirection après paiement (le hash de transaction est
  transmis automatiquement en `&tx=…` pour que la page cible puisse vérifier).

## Déployer CheckoutV2 (pour activer l'USDT)

1. Ouvrir [Remix](https://remix.ethereum.org), coller `contract/CheckoutV2.sol`.
2. Compiler (Solidity 0.8.x), déployer sur **BNB Smart Chain mainnet** avec
   ton wallet propriétaire.
3. Dans le contrat déployé : `setProductPrice('product1', …)` pour le prix BNB,
   puis `setProductPriceInToken('product1', USDT, …)` pour le prix USDT.
   (USDT BSC : `0x55d398326f99059fF775485246999027B3197955`.)
4. Mettre la nouvelle adresse dans `config.js` (`contract`) — l'option
   « Payer en USDT » s'affiche alors automatiquement pour chaque produit
   qui a un prix USDT.

## Tester en local

Ouvrir directement `index.html?product=product2` dans un navigateur
(fonctionne en `file://` — la lecture blockchain passe par les RPC publics).

La page de livraison se teste avec une transaction réelle du contrat :
`delivery.html?product=product2&tx=0x…` (un mauvais hash affiche le message
« Transaction introuvable », c'est le comportement attendu).

## Limites honnêtes (v1)

- La vérification de livraison est **côté client** : elle empêche un faux lien
  (aucun paiement), mais le hash d'un vrai paiement reste public — le bouton
  « Vérifier que c'est bien mon wallet » renforce le contrôle. Un verrouillage
  strict 1-paiement-1-client demanderait une couche serveur (hors scope).
- La livraison reste une page statique : si tu veux protéger le contenu
  lui-même, il faudra une vraie page d'accès protégée un jour.

## Repos

- `Nypsus/Crypto-Checkout` — **prod** (stable, en ligne, ne pas casser).
- `Nypsus/Crypto-Checkout-Full` — **ce repo** (labo des briques complètes).
