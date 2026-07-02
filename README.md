# 🐱⚔️ MAKS — Mega Arena Kombat Stars

Jeu mobile de combat de machines **en 3D**, inspiré de *CATS: Crash Arena Turbo Stars* — en mieux :
pas de minuteurs d'attente, pas de pubs, 100 % jouable hors-ligne.

- **Rendu 3D temps réel** (Three.js) : véhicules modélisés en 3D avec détails par
  châssis (aileron, rivets, nageoire, antenne, phares, décalcos), arène nocturne avec
  **tribunes et foule animée**, panneaux publicitaires, gratte-ciels, projecteurs et lune,
  ombres portées, **bloom** (post-processing), explosions, ondes de choc, rayons laser,
  poussière des roues, caméra cinématique qui suit l'action.
- **Physique réaliste** (Matter.js) : les véhicules roulent, se percutent, grimpent
  l'un sur l'autre, se retournent.
- **Design soigné** : typo Baloo 2 embarquée, icônes SVG dessinées main, garage avec
  podium tournant, écran VS animé, confettis de victoire.

## 🎮 Le jeu

- **Construis ta machine** : un corps (Classique, Titan, Surfeur, Baleine, Poney),
  deux roues, des armes (Lame, Scie, Perceuse, Dard, Roquettes, Laser, Mitrailleuse)
  et des gadgets (Booster, Rétrofusée, Kit de soin, Blindage).
- **Peins ton châssis** : 10 couleurs de carrosserie par corps.
- **Choisis ton co-pilote** : Ronron (soin), Tigrou (frénésie de mêlée),
  Zigzag (méga-boost) ou Pixel (surcharge des armes) — un passif permanent
  + une capacité automatique par combat. Débloqués en montant de ligue.
- **Gère ton énergie** ⚡ : chaque arme/gadget a un coût, la capacité dépend du corps.
- **Combats automatiques** : les chats pilotent tout seuls !
- **Conditions de victoire** : détruire l'adversaire, le retourner (2,5 s sur le dos = KO),
  ou le pousser dans les **murs de la mort** qui se referment après 45 s.
- **Championnat comme dans CATS** : chaque étape est un groupe de **14 adversaires**
  (des « joueurs » générés avec nom, avatar et machine reproductibles). Chacun détient
  une **médaille** : bats-le pour la lui prendre. **8 médailles = promotion** à l'étape
  suivante. Le **Grand Combat** enchaîne les adversaires restants sans pause pour une
  promotion express — une seule défaite met fin à la série.
- **Ligues** : Bois → Bronze → Argent → Or → Diamant → Légende, avec primes de pièces
  et co-pilotes à débloquer. Chaque ligue a **son ambiance d'arène** (couchant de
  Bronze, nuit étoilée d'Argent, or crépusculaire, néons de Diamant, enfer de Légende).
- **Boss de fin de ligue** : la dernière étape avant chaque changement de ligue se
  termine par un **Champion couronné** 👑, plus fort mais qui paie 50% de plus.
- L'écran championnat **code la difficulté par couleur** (vert = à ta portée,
  rouge = costaud) — choisis tes cibles, il ne faut que 8 médailles sur 14.
- **Roues cloutées** : elles mordent l'adversaire au contact (dégâts continus).
- **Les Paris** 🎲 : regarde deux machines s'affronter et mise sur le vainqueur —
  les cotes (×1.1 à ×5) sont calculées sur le rapport de puissance réel.
- **Prestige** ⭐ : après l'étape 24, le championnat recommence à l'étape 1 avec
  +4% de puissance permanente par prestige… et des adversaires bien plus féroces
  (+35% par prestige). Grosse prime de pièces à chaque tour complet.
- **Progression** : victoires → pièces d'or + nouvelles pièces (rareté 1★ à 5★),
  amélioration (niveau max = 1 + 5×étoiles), recyclage.
- **Sauvegarde automatique** en local.

## ▶️ Jouer dans un navigateur

```bash
npx http-server www -p 8080
# puis ouvrir http://localhost:8080 (idéalement en mode responsive iPhone)
```

Aucun build nécessaire : HTML/CSS/JS pur. Three.js et Matter.js sont embarqués
dans `www/js/lib/` (zéro dépendance réseau).

## 📱 Construire l'app iOS (Capacitor)

Sur un Mac avec Xcode installé :

```bash
npm install            # installe Capacitor
npm run ios:add        # crée le projet Xcode (ios/)
npm run ios:sync       # copie www/ dans l'app
npm run ios:open       # ouvre Xcode → sélectionne ton équipe de signature → Run
```

L'app est déclarée en portrait, plein écran, fond sombre (`capacitor.config.json`).
Alternative sans Mac : le jeu est aussi une **PWA** — ouvre l'URL dans Safari iOS
puis « Partager → Sur l'écran d'accueil » pour l'installer en plein écran.

## 🗂 Structure

```
www/
  index.html        écrans (accueil, garage, VS, combat, résultat) + icônes SVG
  css/style.css     design system mobile (Baloo 2, safe-areas iOS, portrait)
  fonts/            police Baloo 2 embarquée (woff2)
  js/data.js        catalogue des pièces + équilibrage + RNG à graine
  js/state.js       sauvegarde, inventaire, montage, adversaires, récompenses
  js/car.js         géométrie logique des véhicules (physique ET 3D)
  js/models3d.js    modèles 3D procéduraux (véhicules, armes, arène, murs)
  js/render3d.js    renderers, scènes studio, éclairages
  js/thumbs.js      vignettes 3D des pièces et véhicules (avec cache)
  js/battle.js      moteur de combat (physique Matter.js + rendu 3D + IA)
  js/garage.js      garage avec aperçu 3D sur podium tournant
  js/sfx.js         sons procéduraux WebAudio (aucun fichier audio)
  js/main.js        navigation, écran d'accueil 3D, confettis
  sw.js             service worker (hors-ligne)
capacitor.config.json  config iOS
```

## 🧠 Comment marche un combat

1. Chaque véhicule équipé devient un corps rigide composé (châssis + armes soudées)
   avec deux roues contraintes en rotation — la simulation est 100 % physique.
2. L'IA conduit vers l'adversaire (ou garde ses distances avec la Rétrofusée),
   déclenche boosters et armes à distance selon leur cadence.
3. Les dégâts de mêlée s'appliquent au contact (période de 250 ms), les projectiles
   volent en cloche avec dégâts de zone pour les roquettes.
4. La 3D n'est qu'une « peau » : positions et rotations sont recopiées de la
   physique 2D vers la scène Three.js à chaque frame (x → x, y → hauteur).
