// Schéma de la base documentaire MongoDB : collections, validateurs ($jsonSchema)
// et index. Équivalent NoSQL de database/migrations/ : idempotent, rejouable.
//
// Collections
//   event_templates / ticket_templates  thèmes visuels (documents embarqués, ~10 docs)
//   event_pages   page éditoriale d'un événement : programme, médias, sections, FAQ
//                 (1 document par événement SQL, modèle EMBARQUÉ : lu d'un bloc)
//   avis          avis des acheteurs, réponse de l'organisateur imbriquée
//                 (modèle RÉFÉRENCÉ : volume proportionnel aux ventes, identifiants SQL)
//   activites     journal d'activité append-only (vues, recherches, scans, connexions,
//                 achats) : schéma souple par type, index TTL (rétention 90 jours)
//
// Lien avec PostgreSQL : les champs evenementId / utilisateurId / organisateurId
// sont les clés primaires SQL (source de vérité). Aucune clé étrangère inter-bases :
// la cohérence est assurée par l'API (vérification SQL avant écriture Mongo).

export const ACTIVITY_TYPES = ['vue_evenement', 'recherche', 'scan_checkin', 'connexion', 'achat'];
export const ACTIVITY_TTL_SECONDS = 90 * 24 * 3600;

const requiredInt = { bsonType: 'int', minimum: 1 };
const nonEmptyString = { bsonType: 'string', minLength: 1 };

export const COLLECTIONS = {
  event_templates: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['templateId', 'name', 'theme', 'ticketTemplateId'],
        properties: {
          templateId: { bsonType: 'string', pattern: '^[a-z][a-z0-9-]*$' },
          name: nonEmptyString,
          theme: {
            bsonType: 'object',
            required: ['primaryColor', 'accentColor', 'heroLayout'],
            properties: {
              heroLayout: { enum: ['festival', 'concert', 'conference', 'theatre', 'sport', 'standard'] },
            },
          },
          ticketTemplateId: nonEmptyString,
        },
      },
    },
    indexes: [[{ templateId: 1 }, { unique: true, name: 'uq_templateId' }]],
  },

  ticket_templates: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['templateId', 'name', 'headerTitle', 'style'],
        properties: {
          templateId: { bsonType: 'string', pattern: '^[a-z][a-z0-9-]*$' },
          style: {
            bsonType: 'object',
            required: ['cardBg', 'cardTextColor', 'watermarkOpacity'],
            properties: { watermarkOpacity: { bsonType: 'double', minimum: 0, maximum: 1 } },
          },
        },
      },
    },
    indexes: [[{ templateId: 1 }, { unique: true, name: 'uq_templateId' }]],
  },

  event_pages: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['evenementId', 'slug', 'templateId', 'programme', 'medias', 'sections', 'faq', 'updatedAt'],
        properties: {
          evenementId: requiredInt,
          organisateurId: requiredInt,
          slug: { bsonType: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
          templateId: nonEmptyString,
          tags: { bsonType: 'array', items: nonEmptyString, maxItems: 20 },
          programme: {
            bsonType: 'array',
            maxItems: 100,
            items: {
              bsonType: 'object',
              required: ['heure', 'titre'],
              properties: {
                heure: { bsonType: 'date' },
                scene: { bsonType: 'string' },
                titre: nonEmptyString,
                artiste: { bsonType: 'string' },
                dureeMin: { bsonType: 'int', minimum: 1, maximum: 1440 },
              },
            },
          },
          medias: {
            bsonType: 'array',
            maxItems: 30,
            items: {
              bsonType: 'object',
              required: ['type', 'url'],
              properties: {
                type: { enum: ['image', 'video', 'audio'] },
                url: { bsonType: 'string', pattern: '^https?://' },
                legende: { bsonType: 'string' },
              },
            },
          },
          sections: {
            bsonType: 'array',
            maxItems: 20,
            items: { bsonType: 'object', required: ['title', 'content'] },
          },
          faq: {
            bsonType: 'array',
            maxItems: 30,
            items: { bsonType: 'object', required: ['question', 'answer'] },
          },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
    indexes: [
      [{ evenementId: 1 }, { unique: true, name: 'uq_evenementId' }],
      [{ slug: 1 }, { unique: true, name: 'uq_slug' }],
      [{ organisateurId: 1 }, { name: 'ix_organisateur' }],
      [{ tags: 1 }, { name: 'ix_tags' }],
      [
        { 'programme.artiste': 'text', 'programme.titre': 'text', 'sections.content': 'text', 'faq.question': 'text' },
        { name: 'tx_contenu', default_language: 'french', weights: { 'programme.artiste': 10, 'programme.titre': 5 } },
      ],
    ],
  },

  avis: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['evenementId', 'utilisateurId', 'utilisateur', 'note', 'commentaire', 'createdAt'],
        properties: {
          evenementId: requiredInt,
          utilisateurId: requiredInt,
          utilisateur: { bsonType: 'object', required: ['prenom'], properties: { prenom: nonEmptyString } },
          // Note entière 1..5 : équivalent d'une contrainte CHECK.
          note: { bsonType: 'int', minimum: 1, maximum: 5 },
          titre: { bsonType: 'string', maxLength: 120 },
          commentaire: { bsonType: 'string', minLength: 1, maxLength: 2000 },
          utile: { bsonType: 'int', minimum: 0 },
          reponseOrganisateur: {
            bsonType: 'object',
            required: ['texte', 'date'],
            properties: { texte: { bsonType: 'string', minLength: 1, maxLength: 2000 }, date: { bsonType: 'date' } },
          },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
        },
      },
    },
    indexes: [
      // Un seul avis par acheteur et par événement.
      [{ evenementId: 1, utilisateurId: 1 }, { unique: true, name: 'uq_evenement_utilisateur' }],
      [{ evenementId: 1, createdAt: -1 }, { name: 'ix_evenement_date' }],
      [{ utilisateurId: 1 }, { name: 'ix_utilisateur' }],
      // Index partiel : avis négatifs seulement (file de modération de l'organisateur),
      // bien plus petit que la collection entière.
      [
        { evenementId: 1, utile: -1 },
        { name: 'ix_negatifs', partialFilterExpression: { note: { $lte: 2 } } },
      ],
    ],
  },

  activites: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['type', 'ts'],
        properties: {
          type: { enum: ACTIVITY_TYPES },
          ts: { bsonType: 'date' },
          utilisateurId: { bsonType: ['int', 'null'] },
          evenementId: { bsonType: ['int', 'null'] },
          // Charge utile libre : sa forme dépend du type (schéma souple assumé).
          payload: { bsonType: 'object' },
        },
      },
    },
    indexes: [
      [{ evenementId: 1, ts: -1 }, { name: 'ix_evenement_ts' }],
      [{ type: 1, ts: -1 }, { name: 'ix_type_ts' }],
      [{ utilisateurId: 1, ts: -1 }, { name: 'ix_utilisateur_ts', sparse: true }],
      // Rétention automatique : les documents sont purgés 90 jours après `ts`.
      [{ ts: 1 }, { name: 'ttl_ts', expireAfterSeconds: ACTIVITY_TTL_SECONDS }],
    ],
  },
};

/** Crée (ou met à jour) collections, validateurs et index. Idempotent. */
export async function applySchema(db, { log = console.log } = {}) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, spec] of Object.entries(COLLECTIONS)) {
    if (existing.has(name)) {
      await db.command({ collMod: name, validator: spec.validator, validationLevel: 'strict', validationAction: 'error' });
    } else {
      await db.createCollection(name, { validator: spec.validator, validationLevel: 'strict', validationAction: 'error' });
    }
    for (const [keys, options] of spec.indexes) {
      try {
        await db.collection(name).createIndex(keys, options);
      } catch (err) {
        // 85 IndexOptionsConflict / 86 IndexKeySpecsConflict : un index de même clé ou de même
        // nom existe avec d'autres options (ex. créé sans nom) : on le remplace.
        if (err.code !== 85 && err.code !== 86) throw err;
        const sameKeys = JSON.stringify(keys);
        for (const existingIndex of await db.collection(name).indexes()) {
          if (existingIndex.name === options.name || JSON.stringify(existingIndex.key) === sameKeys) {
            await db.collection(name).dropIndex(existingIndex.name);
          }
        }
        await db.collection(name).createIndex(keys, options);
      }
    }
    log(`✓ collection ${name} : validateur + ${spec.indexes.length} index`);
  }
}
