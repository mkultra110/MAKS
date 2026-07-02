# 🐱⚔️ MAKS — Mega Arena Kombat Stars

Jeu mobile de combat de machines inspiré de **CATS: Crash Arena Turbo Stars** — en mieux :
pas de minuteurs d'attente, pas de pubs, 100 % jouable hors-ligne, physique 2D réaliste.

## 🎮 Le jeu

- **Construis ta machine** : choisis un corps (Classique, Titan, Surfeur, Baleine, Poney),
  deux roues, des armes (Lame, Scie, Perceuse, Dard, Roquettes, Laser, Mitrailleuse)
  et des gadgets (Booster, Rétrofusée, Kit de soin, Blindage).
- **Gère ton énergie** ⚡ : chaque arme/gadget a un coût, la capacité dépend du corps.
- **Combats automatiques** : les chats pilotent tout seuls ! Physique complète
  (Matter.js) : les véhicules roulent, se percutent, se retournent…
- **Conditions de victoire** : détruire l'adversaire, le retourner (2,5 s sur le dos = KO),
  ou le pousser dans les **murs de la mort** qui se referment après 45 s.
- **Progression** : victoires → pièces d'or + nouvelles pièces (rareté 1★ à 5★),
  améliore tes pièces (niveau max = 1 + 5×étoiles), recycle les doublons,
  grimpe les étapes du championnat (3 victoires par étape, adversaires de plus en plus forts).
- **Sauvegarde automatique** en local.

## ▶️ Jouer dans un navigateur

```bash
npx http-server www -p 8080
# puis ouvrir http://localhost:8080 (idéalement en mode responsive iPhone)
```

Aucun build nécessaire : HTML/CSS/JS pur + Matter.js embarqué (`www/js/lib/matter.min.js`).

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
  index.html        écrans (garage, VS, combat, résultat)
  css/style.css     interface mobile (safe-areas iOS, portrait)
  js/data.js        catalogue des pièces + équilibrage + RNG à graine
  js/state.js       sauvegarde, inventaire, montage, adversaires, récompenses
  js/car.js         géométrie + dessin des véhicules (procédural, zéro asset)
  js/battle.js      moteur de combat (physique Matter.js, IA, effets)
  js/garage.js      interface du garage
  js/sfx.js         sons procéduraux WebAudio (aucun fichier audio)
  js/main.js        navigation et boucle de jeu
  sw.js             service worker (hors-ligne)
capacitor.config.json  config iOS
```
