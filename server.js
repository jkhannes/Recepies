const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'db');
const DB_FILE = path.join(DB_DIR, 'recipes.db');
const LEGACY_JSON = path.join(__dirname, 'data', 'recipes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Sonstiges',
    servings INTEGER NOT NULL DEFAULT 2,
    prepTime INTEGER NOT NULL DEFAULT 0,
    ingredients TEXT NOT NULL DEFAULT '[]',
    nutrition TEXT NOT NULL DEFAULT '{}',
    tags TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

function rowToRecipe(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    servings: row.servings,
    prepTime: row.prepTime,
    ingredients: JSON.parse(row.ingredients),
    nutrition: JSON.parse(row.nutrition),
    tags: JSON.parse(row.tags),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function recipeToRow(r) {
  return {
    ...r,
    ingredients: JSON.stringify(r.ingredients || []),
    nutrition: JSON.stringify(r.nutrition || {}),
    tags: JSON.stringify(r.tags || []),
  };
}

const stmts = {
  all: db.prepare('SELECT * FROM recipes'),
  get: db.prepare('SELECT * FROM recipes WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO recipes (id, title, description, category, servings, prepTime, ingredients, nutrition, tags, createdAt, updatedAt)
    VALUES (@id, @title, @description, @category, @servings, @prepTime, @ingredients, @nutrition, @tags, @createdAt, @updatedAt)
  `),
  update: db.prepare(`
    UPDATE recipes SET title = @title, description = @description, category = @category,
      servings = @servings, prepTime = @prepTime, ingredients = @ingredients,
      nutrition = @nutrition, tags = @tags, updatedAt = @updatedAt
    WHERE id = @id
  `),
  delete: db.prepare('DELETE FROM recipes WHERE id = ?'),
};

function listRecipes() {
  return stmts.all.all().map(rowToRecipe);
}

function getRecipe(id) {
  const row = stmts.get.get(id);
  return row ? rowToRecipe(row) : null;
}

function insertRecipe(recipe) {
  stmts.insert.run(recipeToRow(recipe));
}

function updateRecipe(recipe) {
  stmts.update.run(recipeToRow(recipe));
}

function deleteRecipe(id) {
  stmts.delete.run(id);
}

// Einmalige Migration alter JSON-Daten
(function migrateLegacyJson() {
  if (!fs.existsSync(LEGACY_JSON)) return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM recipes').get().c;
  if (count > 0) return;
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8'));
    const insertMany = db.transaction((recipes) => {
      for (const r of recipes) insertRecipe(normalizeRecipe(r));
    });
    insertMany(legacy.recipes || []);
    console.log(`${(legacy.recipes || []).length} Rezepte aus data/recipes.json migriert.`);
  } catch (err) {
    console.error('Migration fehlgeschlagen:', err.message);
  }
})();

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeRecipe(input, existing) {
  const recipe = {
    id: (existing && existing.id) || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: String(input.title || '').trim(),
    description: String(input.description || '').trim(),
    category: String(input.category || 'Sonstiges').trim(),
    servings: Number(input.servings) > 0 ? Number(input.servings) : (existing && existing.servings) || 2,
    prepTime: Number(input.prepTime) >= 0 ? Number(input.prepTime) : (existing && existing.prepTime) || 0,
    ingredients: Array.isArray(input.ingredients)
      ? input.ingredients
          .map((i) => ({
            name: String((i && i.name) || '').trim(),
            amount: String((i && i.amount) || '').trim(),
            unit: String((i && i.unit) || '').trim(),
          }))
          .filter((i) => i.name)
      : [],
    nutrition: {
      calories: Number(input.nutrition && input.nutrition.calories) || 0,
      protein: Number(input.nutrition && input.nutrition.protein) || 0,
      carbs: Number(input.nutrition && input.nutrition.carbs) || 0,
      fat: Number(input.nutrition && input.nutrition.fat) || 0,
      fiber: Number(input.nutrition && input.nutrition.fiber) || 0,
    },
    tags: Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
      : [],
    createdAt: (existing && existing.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return recipe;
}

function validate(recipe) {
  if (!recipe.title) return 'Titel fehlt.';
  if (!recipe.ingredients.length) return 'Mindestens eine Zutat erforderlich.';
  return null;
}

function matchScore(recipe, pantry) {
  if (!pantry.length) return 0;
  const names = recipe.ingredients.map((i) => i.name.toLowerCase());
  let hits = 0;
  for (const p of pantry) {
    const needle = p.toLowerCase();
    if (names.some((n) => n.includes(needle) || needle.includes(n))) hits++;
  }
  return hits / pantry.length;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  // Static frontend
  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const full = path.normalize(path.join(PUBLIC_DIR, filePath));
    if (!full.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };
    fs.readFile(full, (err, data) => {
      if (err) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, index) => {
          if (err2) {
            res.writeHead(404);
            return res.end('Not found');
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(index);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  const parts = pathname.split('/').filter(Boolean); // ['api', 'recipes', id?]

  try {
    if (req.method === 'GET' && (pathname === '/api/recipes' || pathname === '/api/recipes/')) {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const category = url.searchParams.get('category');
      let list = listRecipes();
      if (q) {
        list = list.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.tags.some((t) => t.includes(q)) ||
            r.ingredients.some((i) => i.name.toLowerCase().includes(q))
        );
      }
      if (category && category !== 'all') {
        list = list.filter((r) => r.category === category);
      }
      return send(res, 200, { recipes: list });
    }

    if (req.method === 'POST' && pathname === '/api/recipes') {
      const body = await readBody(req);
      const recipe = normalizeRecipe(body);
      const error = validate(recipe);
      if (error) return send(res, 400, { error });
      insertRecipe(recipe);
      return send(res, 201, { recipe });
    }

    const id = parts[2];
    if (id) {
      const existing = getRecipe(id);
      if (!existing) return send(res, 404, { error: 'Rezept nicht gefunden.' });

      if (req.method === 'GET') return send(res, 200, { recipe: existing });

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const recipe = normalizeRecipe(body, existing);
        const error = validate(recipe);
        if (error) return send(res, 400, { error });
        updateRecipe(recipe);
        return send(res, 200, { recipe });
      }

      if (req.method === 'DELETE') {
        deleteRecipe(id);
        return send(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && (pathname === '/api/suggestions' || pathname === '/api/suggestions/')) {
      const pantry = (url.searchParams.get('pantry') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const maxCalories = Number(url.searchParams.get('maxCalories')) || 0;
      const category = url.searchParams.get('category');

      let list = listRecipes();
      if (maxCalories > 0) list = list.filter((r) => (r.nutrition.calories || 0) <= maxCalories);
      if (category && category !== 'all') list = list.filter((r) => r.category === category);

      list = list
        .map((r) => ({ recipe: r, score: matchScore(r, pantry) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.recipe);

      return send(res, 200, { suggestions: list });
    }

    return send(res, 404, { error: 'Unbekannter Endpunkt.' });
  } catch (err) {
    return send(res, 400, { error: err.message || 'Ungültige Anfrage.' });
  }
});

server.listen(PORT, () => {
  console.log(`Rezept-App läuft auf http://localhost:${PORT}`);
});
