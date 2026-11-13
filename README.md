# Gantt → Mermaid (local only)

Mała aplikacja React do układania wykresów Gantta i eksportu do Mermaid (do wklejenia w Markdown).
Wszystko działa lokalnie: dane w `localStorage`, Mermaid jest zbundlowany, brak zapytań sieciowych.

## Uruchomienie

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Wersja statyczna: `npm run build`, a potem `npm run preview` albo dowolny lokalny serwer na katalogu `dist/`.

## Co umie

- **Przeciąganie**: pasek zadania (przesunięcie), prawa krawędź (czas trwania), pasek sekcji (cała sekcja),
  pasek projektu (cały harmonogram), kropka za paskiem → upuść na inne zadanie (zależność `after`),
  uchwyt ⠿ (kolejność zadań / przenoszenie między sekcjami / kolejność sekcji). Esc anuluje przeciąganie.
- **Zależności**: zadania zależne same przesuwają się za poprzednikami. Ręczne przesunięcie zależnego zadania usuwa jego zależności.
- **Estymaty PERT** (O / M / P): E = (O+4M+P)/6, σ = (P−O)/6; zakres O–P rysowany jako „wąs” pod paskiem;
  opcjonalnie czas trwania = estymata. Panel projektu pokazuje koniec optymistyczny / pesymistyczny.
- **Weekendy**: `excludes weekends`, czasy w dniach roboczych (tak samo liczy Mermaid).
- **Eksport**: blok ```` ```mermaid ```` do schowka, plik .md, SVG, JSON. Estymaty zapisywane są jako
  komentarze `%% est t1 O=2 M=3 P=5`, więc po imporcie z .md wracają.
- **Import**: kod Mermaid `gantt` lub cały plik .md z blokiem mermaid, albo JSON.
- Wiele projektów, undo/redo (Ctrl+Z / Ctrl+Shift+Z), Delete usuwa zaznaczone zadanie, ciemny motyw.
