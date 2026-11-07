# Recepies

Server-gehostete Rezept-App mit Zutaten-Verwaltung, Nährstoff-Attributen und Vorschlagsliste.
Design: abstrakt-futuristisch, schwarzer Hintergrund mit Neon-Akzenten.

## Features

- **Rezepte speichern** mit Titel, Beschreibung, Kategorie, Portionen, Zubereitungszeit und Tags
- **Zutaten** pro Rezept (Name, Menge, Einheit)
- **Nährwerte** pro Portion: kcal, Protein, Kohlenhydrate, Fett, Ballaststoffe
- **Vorschlagsliste**: gib verfügbare Zutaten ein, das System sortiert passende Rezepte nach Übereinstimmung; optionaler Max-kcal-Filter
- **Suche & Filter** nach Titel, Beschreibung, Tags, Zutaten und Kategorie

## Starten (localhost)

```bash
npm install
npm start
```

Die App läuft dann unter **http://localhost:3000**.

## Daten

Die Rezepte werden in einer **lokalen SQLite-Datenbank** unter `db/recipes.db` gespeichert.
Der Ordner `db/` ist in `.gitignore` und landet nie im Repository.
Für Backups reicht es, die Datei `db/recipes.db` zu sichern.
Bestehende JSON-Daten aus `data/recipes.json` werden beim ersten Start automatisch migriert.

## Später auf eigenen Server

```bash
PORT=8080 npm start
```

Der Server lauscht auf `0.0.0.0` und kann hinter jedem Reverse-Proxy (nginx, Caddy, …) betrieben werden.

## API

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| GET | `/api/recipes?q=&category=` | Rezepte auflisten/suchen |
| POST | `/api/recipes` | Rezept anlegen |
| GET | `/api/recipes/:id` | Einzelnes Rezept |
| PUT | `/api/recipes/:id` | Rezept bearbeiten |
| DELETE | `/api/recipes/:id` | Rezept löschen |
| GET | `/api/suggestions?pantry=Ei,Reis&maxCalories=600` | Vorschlagsliste |
