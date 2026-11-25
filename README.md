# Rock Acro MJGO

Bibliothèque de passes, portés, combinaisons et danses de rock acrobatique de la MJGO, avec profils, vidéos personnelles et journal de progression.

- Site : GitHub Pages
- Données : Supabase (comptes, base, stockage des vidéos)
- `supabase/schema.sql` : tables et règles d'accès à exécuter une fois dans Supabase.
- `supabase/003_nom_utilisateur.sql` : connexion par nom d'utilisateur (l'admin peut redonner un mot de passe). Dans Supabase, désactiver « Confirm email » (Authentication > Sign In / Providers > Email).
- Mail à l'admin à chaque inscription : créer une clé gratuite sur web3forms.com et la coller dans `NOTIFY_KEY` (config.js).
