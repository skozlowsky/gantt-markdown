# Gantt → Mermaid

Edytor wykresów Gantta w przeglądarce z eksportem do [Mermaid](https://mermaid.js.org/syntax/gantt.html),
czyli do formatu, który GitHub, GitLab, Obsidian i wiele innych narzędzi renderuje bezpośrednio w Markdown.

Aplikacja jest w pełni statyczna i działa tylko lokalnie: projekty trzymane są w `localStorage`, pliki czytane
i zapisywane bezpośrednio z dysku, Mermaid jest zbundlowany. Nic nie jest wysyłane na serwer.

## Praca z plikami

- **Otwórz** (Ctrl+O) albo przeciągnij plik na okno: `.md` (bierze pierwszy blok ```` ```mermaid ```` z `gantt`),
  `.mmd` lub `.json`.
- **Zapisz** (Ctrl+S) zapisuje z powrotem do tego samego pliku. W pliku `.md` podmieniany jest **tylko** blok
  z wykresem, reszta dokumentu zostaje bez zmian. Dzięki temu można trzymać harmonogram np. w `README.md`
  albo `docs/plan.md` i edytować go tutaj.
- **Zapisz jako…** (Ctrl+Shift+S) — format wynika z rozszerzenia: `.md`, `.mmd` albo `.json` (pełny stan projektu).
- Estymaty zapisują się jako komentarze `%% est t1 O=2 M=3 P=5`, więc wracają po ponownym otwarciu.

W Chrome / Edge / Operze zapis idzie bezpośrednio do pliku (File System Access API), a aplikacja pamięta plik
także po przeładowaniu strony. Firefox i Safari nie mają tego API: tam „Zapisz” pobiera plik.

## Edycja

- **Przeciąganie**: pasek zadania (przesunięcie), prawa krawędź (czas trwania), pasek sekcji (cała sekcja),
  pasek projektu (cały harmonogram), kropka za paskiem → upuść na inne zadanie (zależność `after`),
  uchwyt ⠿ (kolejność zadań / przenoszenie między sekcjami / kolejność sekcji). Esc anuluje przeciąganie.
- **Zależności**: zadania zależne same przesuwają się za poprzednikami. Ręczne przesunięcie zależnego zadania usuwa jego zależności.
- **Estymaty PERT** (O / M / P): E = (O+4M+P)/6, σ = (P−O)/6; zakres O–P rysowany pod paskiem;
  opcjonalnie czas trwania = estymata. Panel projektu pokazuje koniec optymistyczny / pesymistyczny.
- **Weekendy**: `excludes weekends`, czasy w dniach roboczych (tak samo liczy Mermaid).
- Wiele projektów, cofanie/ponawianie (Ctrl+Z / Ctrl+Shift+Z), Delete usuwa zaznaczone zadanie, ciemny motyw.

## Uruchomienie lokalnie

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

`npm run build` tworzy statyczną wersję w `dist/`.

## GitHub Pages

Workflow `.github/workflows/pages.yml` buduje i publikuje aplikację przy każdym pushu na `main`.
Jednorazowo trzeba włączyć Pages: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
