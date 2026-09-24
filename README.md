# PiCalendar

Wspólna tablica zadań i kalendarz w stylu iOS — minimalistyczna, płynnie animowana i działająca na żywo dla całego zespołu.

- **Tablica** (jak Trello): kolumny *Planowane → W trakcie → Gotowe*. Karty przeciągasz myszką albo palcem (przytrzymaj kartę, żeby ją podnieść).
- **Kalendarz**: widok miesiąca z paskami zadań wielodniowych (od *początku* do *terminu*) i listą zadań na wybrany dzień. Miesiące przewijasz gestem lub strzałkami.
- **Przegląd**: ile jest gotowe, co jest w trakcie, co po terminie, najbliższe 7 dni, kto jest online i kto co ostatnio zmienił.
- **Wiele osób**: każdy wpisuje swoje imię i wybiera kolor. Zmiany innych widać od razu (Server-Sent Events) i pojawiają się jako powiadomienia.
- Wiele tablic (projektów), osoby przypisane do zadań, kolory, listy kontrolne, notatki, filtr „Tylko moje”.
- Tryb ciemny, PWA (na iPhonie: *Udostępnij → Do ekranu początkowego*), `prefers-reduced-motion`.

## Wersja bez serwera: Firebase + GitHub Pages (za darmo, działa 24/7)

Strona leży na GitHub Pages, a dane i synchronizację na żywo trzyma Firestore (darmowy plan Firebase). Nie trzeba mieć włączonego komputera, a aplikacja działa też offline: zmiany wysyłają się po odzyskaniu zasięgu.

1. **Firebase** → [console.firebase.google.com](https://console.firebase.google.com) → *Dodaj projekt* (Google Analytics niepotrzebne).
2. W projekcie: *Build → Firestore Database → Utwórz bazę danych* → lokalizacja `eur3 (europe-west)` → tryb produkcyjny.
3. W zakładce **Reguły** wklej całą zawartość pliku [`firestore.rules`](firestore.rules) i kliknij *Opublikuj*.
4. *Ustawienia projektu (⚙️) → Twoje aplikacje → ikona `</>`* (aplikacja internetowa) → dowolna nazwa, **bez** Firebase Hosting → skopiuj obiekt `firebaseConfig`.
5. Wklej go do [`public/firebase-config.js`](public/firebase-config.js) zamiast `null` (te wartości nie są tajne).
6. **GitHub** → repozytorium → *Settings → Pages → Source: GitHub Actions*. Po każdej zmianie na gałęzi `main` strona publikuje się sama pod adresem `https://<użytkownik>.github.io/<repozytorium>/`.
7. Otwórz ten adres na iPhonie w Safari → *Utwórz przestrzeń zespołu* → wpisz imię → *Udostępnij → Do ekranu początkowego*.
8. W aplikacji: avatar w prawym górnym rogu → *Udostępnij* → wyślij link osobom z zespołu.

**Bezpieczeństwo:** link do przestrzeni (`?s=…`, 24 losowe znaki) działa jak klucz — kto go ma, może czytać i edytować; bez niego nie da się niczego odczytać ani wylistować. Nie publikuj go publicznie.

## Wersja z własnym serwerem (Node.js)

Gdy `public/firebase-config.js` zawiera `null`, aplikacja używa wbudowanego serwera. Wymagany tylko Node.js 18+ — **bez żadnych zależności**, bez budowania.

```bash
npm start          # http://localhost:3000
```

Inne osoby w tej samej sieci otwierają `http://<adres-komputera>:3000` (np. z Raspberry Pi: `http://raspberrypi.local:3000`).

### Konfiguracja (zmienne środowiskowe)

| Zmienna          | Domyślnie  | Opis                                                            |
|------------------|------------|-----------------------------------------------------------------|
| `PORT`           | `3000`     | Port serwera                                                    |
| `HOST`           | `0.0.0.0`  | Adres nasłuchu                                                  |
| `DATA_DIR`       | `./data`   | Gdzie trzymać dane (`db.json`)                                  |
| `PICAL_PASSCODE` | *(brak)*   | Wspólny kod dostępu — bez niego aplikacja jest otwarta dla każdego, kto zna adres |

```bash
PICAL_PASSCODE=tajnehaslo PORT=8080 npm start
```

Jeśli udostępniasz aplikację w internecie, ustaw `PICAL_PASSCODE` i postaw ją za HTTPS (np. Caddy / nginx / Cloudflare Tunnel).

## Dane i kopia zapasowa

Wszystko jest w jednym pliku `data/db.json` (zapisywanym atomowo). Kopia zapasowa = skopiowanie tego pliku.

## Struktura

```
server/index.js   serwer HTTP: REST API, strumień zdarzeń na żywo, pliki statyczne
server/store.js   model danych, walidacja, historia aktywności, zapis na dysk
public/           aplikacja (czysty JS w modułach ES, bez frameworka)
public/js/firebase.js   backend Firebase (Firestore) zamiast serwera
firestore.rules   reguły bezpieczeństwa Firestore
test/             testy API (npm test)
```
