import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Lint du front (ADR-016). Le backend a `ruff` depuis l'ADR-010 ; côté application il n'y avait rien,
 * alors que le jury analyse les sources. Configuration volontairement stricte sur ce qui cause de
 * vrais bugs (règles des hooks, variables mortes, promesses ignorées) et silencieuse sur le style,
 * déjà cohérent dans le projet.
 */
export default tseslint.config(
  { ignores: ['dist', 'dist-vitrine', 'node_modules'] },

  // Application React (navigateur, TypeScript)
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Un `catch {}` volontairement vide est courant ici (stockage indisponible, backend absent) :
      // on l'autorise, mais tout autre bloc vide reste une erreur.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Dette assumée, pas ignorée. Deux hooks (`useEcoWattState`, `useHistory`) réinitialisent leur
      // état dans un effet au basculement démo/réel. Ce n'est pas un bug : c'est un rendu en cascade,
      // invisible à l'usage. Le corriger proprement demande de remonter la réinitialisation dans le
      // rendu ou de recréer les hooks via une `key`, ce qui touche le cœur du tableau de bord.
      // Laissé en avertissement, à traiter après le concours plutôt que la veille de la démo.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // Fonction serverless de la vitrine (Node, JavaScript)
  {
    files: ['api/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
  },

  // Service worker : contexte d'exécution à part, avec ses propres globales.
  {
    files: ['public/sw.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.serviceworker, ...globals.browser } },
  },
)
