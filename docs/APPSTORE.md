# 🚀 Publier MAKS sur l'App Store — guide pas à pas

Tout ce qui pouvait être préparé à l'avance l'est déjà dans ce dépôt :
le projet Capacitor est configuré, l'icône 1024 et l'écran de lancement sont
dans `resources/`, et la fiche App Store est rédigée dans
[`APPSTORE-FICHE.md`](APPSTORE-FICHE.md). Il reste les étapes que **seul le
titulaire du compte Apple** peut faire.

## Ce qu'il te faut

| Quoi | Détail |
|---|---|
| **Compte Apple Developer** | 99 €/an, inscription sur [developer.apple.com](https://developer.apple.com/programs/enroll/). Il faut avoir 18 ans — sinon le compte doit être au nom d'un parent. Compter 24-48 h de validation. |
| **Un Mac avec Xcode** | Obligatoire pour compiler et signer une app iOS. Pas de Mac ? Voir les alternatives en bas. |
| **Un iPhone** | Pour tester en vrai avant d'envoyer (fortement conseillé). |

## Étape 1 — Construire le projet iOS (sur le Mac)

```bash
git clone https://github.com/mkultra110/MAKS.git
cd MAKS
npm install                # Capacitor + générateur d'assets
npx cap add ios            # crée le projet Xcode dans ios/
npm run assets             # génère icônes + écrans de lancement depuis resources/
npx cap sync ios           # copie le jeu (www/) dans l'app
npx cap open ios           # ouvre Xcode
```

## Étape 2 — Dans Xcode

1. Sélectionne le projet **App** → onglet **Signing & Capabilities**.
2. **Team** : choisis ton équipe (ton compte développeur).
3. **Bundle Identifier** : `com.maks.arena` est pré-configuré. S'il est pris,
   change-le (ex. `com.tonpseudo.maks`) **ici ET dans `capacitor.config.json`**.
4. Branche ton iPhone, sélectionne-le comme destination, appuie sur ▶︎ :
   le jeu doit tourner sur ton téléphone. Joue quelques combats !

## Étape 3 — Créer l'app dans App Store Connect

1. Va sur [appstoreconnect.apple.com](https://appstoreconnect.apple.com) →
   **Mes apps** → **+** → **Nouvelle app**.
2. Plateforme iOS, nom **MAKS: Mega Arena Kombat Stars**, langue principale
   **Français**, bundle ID celui de l'étape 2, SKU libre (ex. `maks-001`).
3. Remplis la fiche avec le contenu prêt-à-coller de
   [`APPSTORE-FICHE.md`](APPSTORE-FICHE.md) (description, mots-clés,
   classification, confidentialité).

## Étape 4 — Captures d'écran

Apple exige des captures pour iPhone 6,9" (1320×2868) et accepte qu'elles
servent pour toutes les tailles. Le plus simple :

1. Dans Xcode, lance le jeu dans le **simulateur iPhone 16 Pro Max**.
2. `Cmd + S` fait une capture aux bonnes dimensions.
3. Prends : l'accueil, le garage, l'écran championnat, un combat, une victoire.

## Étape 5 — Envoyer le build

1. Dans Xcode : destination **Any iOS Device (arm64)** → menu **Product → Archive**.
2. Dans la fenêtre Organizer : **Distribute App → App Store Connect → Upload**.
3. Attends ~15 min que le build apparaisse dans App Store Connect, rattache-le
   à la version 1.0, puis **Soumettre pour vérification**.
4. La review Apple prend en général 1 à 3 jours. MAKS coche les bonnes cases :
   pas de pub, pas d'achat, pas de compte, pas de collecte de données, hors-ligne.

> 💡 Conseil : fais d'abord un tour par **TestFlight** (même upload) pour faire
> tester le jeu à des amis avant la soumission publique.

## ⚠️ Deux précautions importantes

- **Ne mentionne jamais « CATS » ni « Crash Arena Turbo Stars »** dans le nom,
  la description ou les mots-clés. MAKS a son propre nom, son propre code et
  ses propres graphismes — s'inspirer d'un genre est parfaitement légal, mais
  citer une marque déposée ferait rejeter l'app.
- Le bundle ID est définitif après la première publication : choisis-le bien.

## Pas de Mac ? Les alternatives

1. **Le Mac d'un ami** : les étapes 1-2-5 prennent moins d'une heure.
2. **CI cloud avec Mac** : [Codemagic](https://codemagic.io) (offre gratuite)
   compile les projets Capacitor iOS dans le cloud avec tes certificats — il
   faut quand même le compte Apple Developer.
3. **Location de Mac dans le cloud** : MacinCloud, ~20 €/mois, accès à distance.
4. **En attendant** : le jeu est déjà une **PWA installable** — ouvre son URL
   dans Safari → Partager → « Sur l'écran d'accueil » : plein écran, hors-ligne,
   icône. Gratuit et immédiat, sans App Store.
