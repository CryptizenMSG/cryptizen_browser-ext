# Cryptizen - Extension Chrome pour la messagerie sécurisée

**Cryptizen** est une extension Chrome qui permet de chiffrer et de déchiffrer des messages échangés sur les réseaux sociaux (Twitter/X, Facebook, Instagram, LinkedIn, etc.). Elle utilise des techniques de chiffrement de pointe pour protéger vos conversations et garantir votre vie privée.

## Présentation du projet

**Cryptizen** vous permet de transformer toutes les messageries des réseaux sociaux en applications de messagerie chiffrée avec des mécanismes de sécurité robustes. L'extension fonctionne de manière totalement locale, sans serveur centralisé, garantissant que vos données restent privées. Elle est open-source, permettant à la communauté de contribuer à son amélioration.

### Fonctionnalités principales
- **Chiffrement hybride** : Utilise **AES-GCM 256** pour le contenu des messages, et la clé AES est chiffrée par **RSA-OAEP** (4096 bits).
- **Authenticité** : Signature des messages via **RSA-PSS** (3072 bits) et validation avec **SHA-256**.
- **Échange de clés simplifié** : Un message spécial `CRYPTIZEN|...` déclenche un **overlay** d'acceptation pour l'échange de clés.
- **Automatique** : Chiffrement automatique à l'envoi (via Enter) et déchiffrement automatique à la réception.
- **Système de configuration** : Un fichier `config.json` permet de définir les sélecteurs CSS pour identifier les champs de saisie et autres éléments spécifiques aux plateformes.
- **Sécurisation des clés privées** : Les clés privées sont stockées localement dans le navigateur avec un système de sauvegarde chiffrée.

## Technologies utilisées

- **Chiffrement** : 
    - **AES-GCM 256** pour le chiffrement des messages.
    - **RSA-OAEP 4096 bits** pour l'échange de clés.
    - **RSA-PSS 3072 bits** pour la signature des messages.
    - **SHA-256** pour l'intégrité des données.

- **JavaScript** : Utilisation de JavaScript moderne pour gérer le chiffrement/déchiffrement en temps réel et l'interface utilisateur.
- **Web Storage** : Les clés privées et autres données sensibles sont stockées localement dans le navigateur via l'API de stockage local.

## Installation (mode développeur)

1. Téléchargez le fichier ZIP contenant le code source de l'extension.
2. Ouvrez `chrome://extensions` dans votre navigateur Chrome.
3. Activez **Mode développeur**.
4. Cliquez sur **Charger l’extension non empaquetée** et sélectionnez le dossier décompressé.
5. Ouvrez un site supporté (par exemple, Twitter/X → DMs).
6. Cliquez sur l’icône **Cryptizen** et générez ou vérifiez vos clés.
7. Ouvrez une conversation et échangez vos clés avec votre correspondant.

## Utilisation

### Format du message
Les messages sont envoyés sous forme de chaînes de texte avec un préfixe `CRYPTIZEN|` suivi d'un JSON encodé en base64url :
- `t: "keyx"` : Demande d’échange de clés, contenant les clés publiques (`enc` pour encryption, `sig` pour signature).
- `t: "msg"` : Message chiffré avec les données `{ iv, ct, ek, hash, sig? }` et des métadonnées.

### Sécurité
- Les **clés privées** sont stockées **localement** dans votre navigateur.
- **Sauvegarde chiffrée** des clés privées disponible.
- Vérifiez le **code à 6 chiffres** affiché lors du premier échange pour éviter les attaques Man-in-the-Middle (MITM).
- Le chiffrement automatique peut être désactivé par conversation ou domaine via le popup ou la page Options.

## Configuration des domaines

Modifiez le fichier `config.json` pour ajuster les sélecteurs CSS et la détection des IDs de conversation via l'URL.
Exemple de configuration pour un domaine :
```json
    {
      "hostPattern": "*.instagram.com",
      "name": "Instagram Direct",
      "selectors": {
        "input": "textarea[placeholder], div[contenteditable='true']",
        "username": "header h2, header span[title]",
        "messageList": "div[role='dialog'], main section"
      },
      "conversationIdFromUrl": "instagram.com/direct/t/(\\d+)"
    }
````

## Limitations connues

* Certaines plateformes imposent des restrictions CSS et des Content Security Policies (CSP) complexes. L'extension utilise un **Shadow DOM** et une feuille de style dédiée pour éviter les conflits.
* L'extension **ne dépend pas de serveurs externes** : tout le traitement des messages se fait localement dans votre navigateur.
* Les messages trop longs peuvent dépasser les limites de certains champs de texte sur les plateformes. Dans ce cas, l'extension fractionne le message automatiquement.

## License

Ce projet est distribué sous la **licence MIT**. Cela signifie que tout le monde peut utiliser, modifier, et redistribuer le code tant qu'il respecte les conditions de la licence, notamment l'interdiction d'utiliser le code pour des fins commerciales sans autorisation.

## Contribuer

Le projet **Cryptizen** est **open-source** et nous encourageons toute contribution de la communauté. Si vous souhaitez contribuer, améliorez des fonctionnalités, ou ajouter de nouveaux réseaux sociaux, n'hésitez pas à ouvrir une *pull request* sur notre dépôt GitHub [Cryptizen - Extension Navigateur Web](https://github.com/CryptizenMSG/cryptizen_browser-ext).

### Contact

Si vous avez des questions, des suggestions ou souhaitez contribuer, contactez-nous à l'adresse suivante : [contact@cryptizen.org](mailto:contact@cryptizen.org).

### Nous rejoindre

**Cryptizen** est encore en développement ! Si vous souhaitez soutenir la liberté individuelle et la protection de la vie privée en ligne, rejoignez-nous et contribuez à ce projet. Nous recherchons activement des développeurs motivés pour améliorer et étendre cette extension.

> **Fondé par** : Tom Vinsonneau

---

## Pourquoi utiliser Cryptizen ?

* **Sécurité supplémentaire** : En cas de piratage d'un réseau social, le chiffrement de vos messages garantit que personne d'autre, même l'opérateur du réseau social, n'a accès à vos conversations.
* **Protéger votre vie privée** : Le projet Cryptizen permet aux citoyens de protéger leurs données personnelles contre les tentatives de surveillance, qu'elles proviennent des gouvernements ou des acteurs malveillants.
* **Extension gratuite et open-source** : Profitez d'une solution de chiffrement gratuite, ouverte et sans serveur centralisé.

---

**Réseaux sociaux compatibles** :

* Instagram
* Twitter/X
* Facebook
* LinkedIn

*Vous pouvez ajouter d'autres plateformes en modifiant le fichier de configuration `config.json`.*

---

__PS :__ Nous vous remercions sincèrement pour votre contribution qui permettent de faire vivre ce nouveau projet ! 💟