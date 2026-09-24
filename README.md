# PiCalendar

Wspólna tablica zadań i kalendarz w stylu iOS — minimalistyczna, płynnie animowana i działająca na żywo dla całego zespołu.

- **Tablica** (jak Trello): kolumny *Planowane → W trakcie → Gotowe*. Karty przeciągasz myszką albo palcem (przytrzymaj kartę, żeby ją podnieść).
- **Kalendarz**: widok miesiąca z paskami zadań wielodniowych (od *początku* do *terminu*) i listą zadań na wybrany dzień. Miesiące przewijasz gestem lub strzałkami.
- **Przegląd**: ile jest gotowe, co jest w trakcie, co po terminie, najbliższe 7 dni, kto jest online i kto co ostatnio zmienił.
- **Wiele osób**: każdy wpisuje swoje imię i wybiera kolor. Zmiany innych widać od razu (Server-Sent Events) i pojawiają się jako powiadomienia.
- Wiele tablic (projektów), osoby przypisane do zadań, kolory, listy kontrolne, notatki, filtr „Tylko moje”.
- Tryb ciemny, PWA (na iPhonie: *Udostępnij → Do ekranu początkowego*), `prefers-reduced-motion`.

## Uruchomienie

Wymagany tylko Node.js 18+ — **bez żadnych zależności**, bez budowania.

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
test/             testy API (npm test)
```
