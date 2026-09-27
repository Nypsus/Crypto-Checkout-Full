// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/* =====================================================================
   CheckoutV2 — contrat de paiement multi-produits / multi-devises
   ---------------------------------------------------------------------
   Évolution compatible du contrat V1 (NewPaymentMultiproducts) :
   - même interface que la V1 pour les paiements en BNB
     (setProductPrice / products / pay / withdraw / withdrawToken),
   - nouvelle fonction productPriceInToken(productId, token) : un prix par
     devise (ex. un prix en USDT en plus du prix en BNB),
   - pay() vérifie amount == prix du couple (produit, devise),
   - paiement natif : exige msg.value == amount (pas de surplus bloqué).

   Conventions :
   - token == 0x0  -> paiement en BNB (natif) ;
   - sinon         -> token BEP20 autorisé ;
   - les fonds (BNB et tokens) partent vers l'adresse de retrait `payout`
     (par défaut le déployeur, modifiable par le propriétaire via setPayout).

   Déploiement : Remix, Solidity 0.8.20+, constructeur `tokens` =
   [0x55d398326f99059fF775485246999027B3197955]  (USDT BSC).
   ===================================================================== */

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

contract CheckoutV2 {
    address public owner;
    address public payout; // adresse qui reçoit les paiements (défaut : déployeur)
    mapping(address => bool) public allowedTokens;

    struct Product {
        uint256 price; // prix natif, en wei (BNB)
        bool exists;
    }

    mapping(string => Product) public products;
    mapping(string => mapping(address => uint256)) public productPriceInToken;

    event PaymentReceived(address indexed user, uint256 amount, address token, string productId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Seul le proprietaire");
        _;
    }

    constructor(address[] memory tokens) {
        owner = msg.sender;
        payout = msg.sender;
        for (uint256 i = 0; i < tokens.length; i++) {
            allowedTokens[tokens[i]] = true;
        }
    }

    /// Adresse qui reçoit les paiements (par défaut le déployeur).
    function setPayout(address newPayout) external onlyOwner {
        require(newPayout != address(0), "Adresse invalide");
        payout = newPayout;
    }

    // ------------------- Gestion des produits -------------------

    /// Prix du produit en BNB (en wei). Ajoute le produit s'il n'existe pas.
    function setProductPrice(string memory productId, uint256 price) external onlyOwner {
        products[productId] = Product(price, true);
    }

    /// Prix du produit dans un token donné (ex. USDT, 18 décimales sur BSC).
    function setProductPriceInToken(string memory productId, address token, uint256 price) external onlyOwner {
        require(products[productId].exists, "Produit inexistant");
        require(allowedTokens[token], "Token non supporte");
        productPriceInToken[productId][token] = price;
    }

    function removeProduct(string memory productId) external onlyOwner {
        delete products[productId];
    }

    // ------------------- Tokens autorisés -------------------

    function addAllowedToken(address token) external onlyOwner {
        allowedTokens[token] = true;
    }

    function removeAllowedToken(address token) external onlyOwner {
        allowedTokens[token] = false;
    }

    function isTokenAllowed(address token) public view returns (bool) {
        return allowedTokens[token];
    }

    // ------------------- Paiement -------------------

    /// token = 0x0 : paiement BNB (msg.value == amount).
    /// token != 0x0 : paiement BEP20 (amount == prix du produit dans ce token,
    /// nécessite un approve() préalable du montant exact).
    function pay(address token, uint256 amount, string memory productId) public payable {
        require(products[productId].exists, "Produit inexistant");

        if (token == address(0)) {
            require(amount == products[productId].price, "Montant incorrect pour ce produit");
            require(msg.value == amount, "Valeur envoyee incorrecte");
            payable(payout).transfer(amount);
        } else {
            require(allowedTokens[token], "Token non supporte");
            require(amount == productPriceInToken[productId][token], "Montant incorrect pour ce produit");
            require(msg.value == 0, "Pas de BNB pour un paiement en token");
            require(IERC20(token).transferFrom(msg.sender, payout, amount), "Echec du transfert de token");
        }

        emit PaymentReceived(msg.sender, amount, token, productId);
    }

    // ------------------- Retraits (secours) -------------------

    /// Récupère du BNB bloqué sur le contrat (les paiements vont normalement
    /// directement au payout, ceci ne sert qu'en secours).
    function withdraw(uint256 amount) external onlyOwner {
        payable(payout).transfer(amount);
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        require(IERC20(token).transfer(payout, amount), "Echec du transfert du token");
    }
}
