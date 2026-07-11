/**
 * Deux visages d'EcoWatt, une seule base de code (ADR-014).
 *
 *  - **Build complet** (défaut, `npm run build`) : celui qu'on lance à la maison et le jour de la
 *    présentation. Bascule démo/réel, connexion au boîtier ESP32, chat servi par le vrai LLM.
 *  - **Build vitrine** (`npm run build:vitrine`) : celui qu'on met en ligne pour le jury et son IA de
 *    présélection. Il tourne à 100 % dans le navigateur, ne connaît aucun backend, ne peut piloter
 *    aucune prise. Le quota Groq et les relais restent hors de portée d'Internet.
 *
 * Sans ce garde-fou, la page déployée en HTTPS appellerait `http://localhost:8000` : le navigateur
 * bloque la requête (contenu mixte) et le repli local ne se déclenche qu'APRÈS une erreur rouge en
 * console, que l'IA de présélection verrait. En vitrine, on ne tente donc simplement pas l'appel.
 */
export const DEMO_ONLY = import.meta.env.VITE_DEMO_ONLY === '1'
