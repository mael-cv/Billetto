SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'b' || md5(string_agg(tarif_id || ':' || commande_id || ':' || code || ':' || created_at, ',' ORDER BY id)) FROM billets
  UNION ALL SELECT 'e' || md5(string_agg(slug || debut || statut || lieu_id, ',' ORDER BY id)) FROM evenements
  UNION ALL SELECT 't' || md5(string_agg(prix || ':' || quota, ',' ORDER BY id)) FROM tarifs
  UNION ALL SELECT 'a' || md5(string_agg(utilisateur_id || ':' || ami_id, ',' ORDER BY id)) FROM amities
) s(x);
