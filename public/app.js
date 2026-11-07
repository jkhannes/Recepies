const $ = (sel) => document.querySelector(sel);

const state = { recipes: [], suggestions: [] };

const API = {
  async list(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category', params.category);
    const res = await fetch('/api/recipes?' + qs.toString());
    return res.json();
  },
  async save(recipe) {
    const isEdit = !!recipe.id;
    const res = await fetch(isEdit ? '/api/recipes/' + recipe.id : '/api/recipes', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    });
    return { ok: res.ok, data: await res.json() };
  },
  async remove(id) {
    const res = await fetch('/api/recipes/' + id, { method: 'DELETE' });
    return res.ok;
  },
  async suggest(pantry, maxCalories, category) {
    const qs = new URLSearchParams();
    if (pantry.length) qs.set('pantry', pantry.join(','));
    if (maxCalories > 0) qs.set('maxCalories', maxCalories);
    if (category && category !== 'all') qs.set('category', category);
    const res = await fetch('/api/suggestions?' + qs.toString());
    return res.json();
  },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderCards() {
  const grid = $('#recipe-grid');
  const tpl = $('#tpl-card');
  grid.innerHTML = '';
  $('#empty-state').classList.toggle('hidden', state.recipes.length > 0);
  for (const r of state.recipes) {
    const node = tpl.content.cloneNode(true);
    node.querySelector('.card-cat').textContent = r.category;
    node.querySelector('.card-time').textContent = r.prepTime ? r.prepTime + ' min' : '';
    node.querySelector('.card-title').textContent = r.title;
    node.querySelector('.card-desc').textContent = r.description || '';
    const tags = node.querySelector('.card-tags');
    (r.tags || []).forEach((t) => {
      const el = document.createElement('span');
      el.className = 'tag';
      el.textContent = t;
      tags.appendChild(el);
    });
    node.querySelector('.n-cal').textContent = Math.round(r.nutrition.calories || 0);
    node.querySelector('.n-protein').textContent = Math.round(r.nutrition.protein || 0) + 'g';
    node.querySelector('.n-carbs').textContent = Math.round(r.nutrition.carbs || 0) + 'g';
    node.querySelector('.n-fat').textContent = Math.round(r.nutrition.fat || 0) + 'g';
    node.querySelector('.card-ingredients-count').textContent = r.ingredients.length + ' Zutaten';
    node.querySelector('.card-btn').addEventListener('click', () => openModal(r));
    grid.appendChild(node);
  }
}

async function refresh() {
  const data = await API.list({
    q: $('#search').value.trim(),
    category: $('#category-filter').value,
  });
  state.recipes = data.recipes || [];
  renderCards();
}

/* ---------- modal ---------- */
function addIngredientRow(ing = {}) {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  row.innerHTML = `
    <input type="text" class="ing-name" placeholder="Zutat" value="${esc(ing.name || '')}" />
    <input type="text" class="ing-amount" placeholder="Menge" value="${esc(ing.amount || '')}" />
    <input type="text" class="ing-unit" placeholder="Einheit" value="${esc(ing.unit || '')}" />
    <button type="button" class="remove-ing" title="Entfernen">✕</button>`;
  row.querySelector('.remove-ing').addEventListener('click', () => row.remove());
  $('#ingredient-list').appendChild(row);
}

function openModal(recipe = null) {
  $('#modal-title').textContent = recipe ? 'Rezept bearbeiten' : 'Neues Rezept';
  $('#f-id').value = recipe ? recipe.id : '';
  $('#f-title').value = recipe ? recipe.title : '';
  $('#f-description').value = recipe ? recipe.description : '';
  $('#f-category').value = recipe ? recipe.category : 'Mittagessen';
  $('#f-servings').value = recipe ? recipe.servings : 2;
  $('#f-preptime').value = recipe ? recipe.prepTime : 15;
  $('#f-tags').value = recipe ? (recipe.tags || []).join(', ') : '';
  const n = recipe ? recipe.nutrition : {};
  $('#f-calories').value = n.calories || '';
  $('#f-protein').value = n.protein || '';
  $('#f-carbs').value = n.carbs || '';
  $('#f-fat').value = n.fat || '';
  $('#f-fiber').value = n.fiber || '';
  $('#ingredient-list').innerHTML = '';
  if (recipe) recipe.ingredients.forEach((i) => addIngredientRow(i));
  else addIngredientRow();
  $('#btn-delete').hidden = !recipe;
  $('#recipe-modal').showModal();
}

function collectForm() {
  const ingredients = [...document.querySelectorAll('.ingredient-row')]
    .map((row) => ({
      name: row.querySelector('.ing-name').value,
      amount: row.querySelector('.ing-amount').value,
      unit: row.querySelector('.ing-unit').value,
    }))
    .filter((i) => i.name.trim());
  return {
    id: $('#f-id').value || null,
    title: $('#f-title').value,
    description: $('#f-description').value,
    category: $('#f-category').value,
    servings: Number($('#f-servings').value) || 2,
    prepTime: Number($('#f-preptime').value) || 0,
    ingredients,
    nutrition: {
      calories: Number($('#f-calories').value) || 0,
      protein: Number($('#f-protein').value) || 0,
      carbs: Number($('#f-carbs').value) || 0,
      fat: Number($('#f-fat').value) || 0,
      fiber: Number($('#f-fiber').value) || 0,
    },
    tags: $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
  };
}

/* ---------- vorschläge ---------- */
function renderSuggestions(pantry) {
  const list = $('#suggestion-list');
  list.innerHTML = '';
  if (!state.suggestions.length) {
    list.innerHTML = '<p class="empty-state">Keine Treffer – leere die Filter oder erstelle passende Rezepte.</p>';
    return;
  }
  state.suggestions.forEach((r, i) => {
    const match = pantry.length
      ? Math.round((r.ingredients.filter((ing) =>
          pantry.some((p) => ing.name.toLowerCase().includes(p) || p.includes(ing.name.toLowerCase()))
        ).length / pantry.length) * 100)
      : null;
    const el = document.createElement('div');
    el.className = 'suggestion-item';
    el.innerHTML = `
      <span class="suggestion-rank">${String(i + 1).padStart(2, '0')}</span>
      <div class="suggestion-info">
        <h4>${esc(r.title)}</h4>
        <p>${esc(r.category)} · ${r.ingredients.length} Zutaten · ${Math.round(r.nutrition.calories || 0)} kcal</p>
      </div>
      ${match !== null ? `<span class="suggestion-match">${match}% Übereinstimmung</span>` : ''}
      <button class="card-btn">Öffnen</button>`;
    el.querySelector('.card-btn').addEventListener('click', () => openModal(r));
    list.appendChild(el);
  });
}

/* ---------- events ---------- */
document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn[data-view]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    $('#view-' + btn.dataset.view).classList.add('active');
  });
});

$('#btn-new').addEventListener('click', () => openModal());
$('#modal-close').addEventListener('click', () => $('#recipe-modal').close());
$('#btn-cancel').addEventListener('click', () => $('#recipe-modal').close());
$('#btn-add-ingredient').addEventListener('click', () => addIngredientRow());

$('#recipe-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const recipe = collectForm();
  if (!recipe.ingredients.length) {
    alert('Bitte mindestens eine Zutat angeben.');
    return;
  }
  const { ok, data } = await API.save(recipe);
  if (!ok) {
    alert(data.error || 'Fehler beim Speichern.');
    return;
  }
  $('#recipe-modal').close();
  await refresh();
});

$('#btn-delete').addEventListener('click', async () => {
  const id = $('#f-id').value;
  if (!id || !confirm('Dieses Rezept wirklich löschen?')) return;
  await API.remove(id);
  $('#recipe-modal').close();
  await refresh();
});

$('#search').addEventListener('input', debounce(refresh, 250));
$('#category-filter').addEventListener('change', refresh);

$('#btn-suggest').addEventListener('click', async () => {
  const pantry = $('#pantry-input').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const maxCalories = Number($('#max-calories').value) || 0;
  const data = await API.suggest(pantry, maxCalories, 'all');
  state.suggestions = data.suggestions || [];
  renderSuggestions(pantry);
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

refresh();
