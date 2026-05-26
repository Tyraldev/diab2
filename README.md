# DiabeteTracker - Application iPhone (PWA)

## Important : fonctionne SANS CSV et SANS cle API

L app fonctionne entierement sur telephone sans aucune dependance :
- Saisie des repas avec glycemie pre-prandiale (lue sur votre Dexcom)
- Estimation des glucides LOCALE (base d aliments integree)
- Analyse des doses LOCALE (calcul automatique)
- Adaptation des ratios LOCALE
- Capture d ecran de la courbe Dexcom (pour le medecin)
- Rapport PDF

La cle API Anthropic et l import CSV sont OPTIONNELS (pour enrichir, depuis un ordinateur).

## Deploiement (20 minutes)

### 1. Compte GitHub
- github.com - creez un compte gratuit

### 2. Repository
- "New repository" - nom "diabete-tracker" - Private - Create

### 3. Upload des fichiers
Deposez dans le repo : package.json, vite.config.js, index.html, vercel.json,
le dossier src/ (main.jsx + App.jsx), le dossier public/ (icon.svg)

### 4. Vercel
- vercel.com - "Add New Project" - connectez GitHub
- Selectionnez "diabete-tracker" - Framework: Vite - Deploy
- Vous obtenez : https://diabete-tracker-xxx.vercel.app

### 5. Installation iPhone
- Safari - ouvrez votre URL Vercel
- Bouton Partager - "Sur l ecran d accueil"
- L app s installe comme une vraie application

### 6. (Optionnel) Cle API pour l IA
- "Mes parametres" - saisissez votre cle Anthropic (console.anthropic.com)
- Permet l estimation glucides IA et l analyse enrichie
- Sans cle, tout fonctionne quand meme en local

## Couts
- GitHub + Vercel : gratuit
- Cle API Anthropic : optionnelle, ~1 EUR/mois si utilisee

## Usage quotidien mobile (sans rien d autre)
1. A chaque repas : ouvrez l app, saisissez heure (auto), description, glucides (bouton Estimer), glycemie avant repas
2. L app suggere la dose
3. Le soir : capture de votre courbe Dexcom + lancez l analyse de la journee
4. L app compare vos doses et apprend vos ratios
