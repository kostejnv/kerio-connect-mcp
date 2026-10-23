# Kerio Connect MCP (pošta)

MCP server, který připojí AI asistenta (Claude, ChatGPT, Claude Code…) ke schránce **Kerio Connect**.
Výchozí režim je **jen pro čtení**: složky, hledání včetně staré historie a celý text zpráv.
Odesílání je volitelné a vyžaduje explicitní zapnutí v konfiguraci serveru.

Fork projektu [aimbitgmbh/kerio-connect-mcp](https://github.com/aimbitgmbh/kerio-connect-mcp) (MIT),
zúžený na poštu a upravený pro spolehlivé čtení a vzdálený provoz.

Server mluví přímo s klientským API Keria (`/webmail/api/jsonrpc`, `Session.login`, session cookie a `X-Token`).
Nepoužívá IMAP, Outlook ani přeposílání pošty.

## Nástroje

| Nástroj | Co dělá | Anotace |
|---|---|---|
| `mail_folders_list` | Poštovní složky s ID a cestou | jen čtení |
| `mail_search` | Hledání ve všech složkách nebo v jedné, od nejnovějších. Fulltext `query` (na serveru) a filtry `from`, `to`, `subject`, `dateFrom`, `dateTo`, `unreadOnly`. Stránkování přes `limit` a `offset`/`nextOffset`. | jen čtení |
| `mail_get` | Zpráva podle ID přes `Mails.getById` (funguje pro libovolně starou zprávu): hlavičky, přílohy (názvy), celý text. Dlouhý text po částech se stavem `COMPLETE` / `PARTIAL` + `nextOffset`. | jen čtení |
| `mail_send` | Odeslání prostého textu (To, Cc, Bcc). **Jen pokud je odesílání zapnuté.** | destruktivní |

Odpovědi `mail_search` vždy říkají, zda je hledání úplné:

- **Jen fulltext / bez filtrů:** Kerio vyhodnotí vše samo, odpověď obsahuje přesný celkový počet shod
  (`Showing results 1-20 of 1234`) a `nextOffset`.
- **S filtry odesílatel/příjemce/předmět/datum/nepřečtené:** dokumentace API neuvádí, podle kterých polí lze filtrovat na
  serveru, proto je server prochází stránkovaně sám (až 5 000 zpráv na jedno volání; u filtru `dateFrom` končí dřív, protože
  výsledky jdou od nejnovějších). Pokud volání nedoběhne do konce, odpověď řekne `Search NOT finished` a vrátí `nextOffset`.
  Prázdný výsledek tedy nikdy neznamená jen „v prvních pár zprávách nic nebylo“.

Čtení nevolá žádnou metodu, která mění zprávy: stav přečtení, příznaky ani umístění se nemění.

## Bezpečnostní model

- **Seznam povolených API metod** v klientu: ve čtecím režimu jen `Session.login`, `Folders.get`, `Mails.get`,
  `Mails.getById`. Po zapnutí odesílání navíc `Mails.create`, a to jen pro jednu novou zprávu s `send: true`
  (žádné koncepty ani šablony). Ostatní volání se odmítnou ještě před odesláním požadavku.
- **Zakázané odesílání** se vynucuje třikrát: nástroj `mail_send` chybí v seznamu nástrojů, jeho přímé zavolání se odmítne
  a klient sám zablokuje `Mails.create`. Agent přepínač přes MCP změnit nemůže.
- **Odesílání se nikdy automaticky neopakuje.** Výsledek je `SENT`, `SENT WITH WARNINGS` (odesláno, ale např. chybí kopie
  v Odeslané poště), `NOT SENT`, nebo `RESULT UNKNOWN` (timeout, přerušené spojení). U posledních dvou agent dostane pokyn
  zprávu znovu neposílat a nechat uživatele ověřit Odeslanou poštu.
- **Čtecí požadavky** se po vypršení relace jednou zopakují s novým přihlášením.
- **TLS** se vždy ověřuje. Firemní certifikační autoritu přidáte přes `KERIO_CA_FILE`, ověřování nejde vypnout.
- **Odchozí spojení** jen přes `https`. Adresy v privátních a lokálních sítích jsou blokované (kontroluje se i po DNS resolve),
  volitelně je lze omezit na seznam `KERIO_ALLOWED_SERVERS`.
- **Obsah e-mailů** je pro agenta označený jako nedůvěryhodná data (`<<<BEGIN UNTRUSTED EMAIL CONTENT>>>`) a popisy nástrojů
  ho výslovně upozorňují, ať v e-mailech nenásleduje instrukce.
- **Logy** neobsahují hesla, tokeny, cookies ani obsah zpráv.

> **Používejte běžný uživatelský účet, ne administrátorský.** Režim jen pro čtení omezuje tento konektor,
> ne samotné přihlašovací údaje: s heslem lze ve webmailu nebo jinými klienty dělat cokoliv, co účet dovoluje.

### Přihlášení ve vzdáleném režimu (OAuth, server nic neukládá)

1. Při přidání connectoru otevře Claude/ChatGPT přihlašovací stránku tohoto serveru.
2. Uživatel zadá adresu Kerio serveru, login a heslo. Server se ke Keriu zkusí přihlásit a teprve při úspěchu vydá token.
3. Údaje se zašifrují (AES-256-GCM) klíčem `MCP_TOKEN_KEY` přímo do tokenů, které drží MCP klient. Na serveru se neukládá
   nic (žádná databáze, žádné soubory). Při každém požadavku se token rozšifruje jen v paměti.
4. Přístupový token platí 1 hodinu, obnovovací 90 dní (obnovuje se s každým použitím). Změnou `MCP_TOKEN_KEY` se okamžitě
   odhlásí všechna připojení.

Zbytkové riziko: kdo by získal token od MCP klienta **a zároveň** klíč ze serveru, dostane se k heslu.

## Připojení klienta

### Claude.ai / Claude Desktop / ChatGPT (vzdálený server)

- **Claude:** Settings → Connectors → Add custom connector → URL `https://kerio.kostejnv.cz/mcp`.
- **ChatGPT:** Settings → Apps & Connectors → (Developer mode) → Create → MCP Server URL `https://kerio.kostejnv.cz/mcp`,
  Authentication: OAuth.
- **Claude Code:** `claude mcp add --transport http kerio https://kerio.kostejnv.cz/mcp`, pak `/mcp` → Authenticate.

Po přidání se otevře přihlašovací stránka. Zadejte Kerio server (např. `mail.firma.cz`), login a heslo.

### Výchozí režim: jen čtení

Na serveru je `KERIO_ALLOW_SEND=false` (nebo chybí). Přihlašovací stránka žádnou volbu odesílání nenabízí
a žádné připojení nemůže posílat e-maily.

### Explicitní zapnutí odesílání

1. Na serveru nastavte v `.env` `KERIO_ALLOW_SEND=true` a restartujte kontejner (`docker compose up -d`).
2. Přihlašovací stránka pak nabídne zaškrtávátko **Povolit odesílání e-mailů**, ve výchozím stavu nezaškrtnuté.
3. Pro odesílání přidejte (nebo znovu připojte) connector a zaškrtávátko zaškrtněte. Ostatní připojení zůstávají jen pro čtení.

Platí jen hodnota přesně `true`; jiná hodnota (`TRUE`, `1`, `yes`…) zastaví start serveru, takže překlep odesílání nikdy nezapne.

### Lokálně přes stdio (jedna schránka)

```json
{
  "mcpServers": {
    "kerio": {
      "command": "node",
      "args": ["/cesta/k/kerio-connect-mcp/dist/index.js"],
      "env": {
        "KERIO_SERVER": "mail.firma.cz",
        "KERIO_USERNAME": "jan@firma.cz",
        "KERIO_PASSWORD": "…",
        "KERIO_ENABLE_SEND": "false"
      }
    }
  }
}
```

Odesílání se ve stdio režimu zapíná `KERIO_ENABLE_SEND=true`.

## Nasazení (Docker za reverzní proxy)

```bash
git clone https://github.com/kostejnv/kerio-connect-mcp.git /root/kerio-mcp
cd /root/kerio-mcp
cp .env.example .env && chmod 600 .env
# doplnit PUBLIC_URL a MCP_TOKEN_KEY (openssl rand -base64 32)
docker compose up -d --build
```

Kontejner nevystavuje žádný port a připojí se do sítě `shared_net`. V Caddy stačí:

```
kerio.kostejnv.cz {
    reverse_proxy kerio-mcp:3000
}
```

Aktualizace: `git pull && docker compose up -d --build`.

## Konfigurace

| Proměnná | Režim | Výchozí | Popis |
|---|---|---|---|
| `MCP_TRANSPORT` | oba | `stdio` | `stdio` nebo `http` (Docker image nastavuje `http`) |
| `PUBLIC_URL` | http | — | Veřejná https adresa serveru |
| `PORT` | http | `3000` | Port uvnitř kontejneru |
| `MCP_TOKEN_KEY` | http | — | 32 náhodných bajtů v base64; šifruje tokeny |
| `KERIO_ALLOW_SEND` | http | `false` | Hlavní vypínač; `true` = nabídnout odesílání jako volbu připojení |
| `KERIO_ALLOWED_SERVERS` | http | prázdné | Povolené Kerio hosty, oddělené čárkou (prázdné = libovolný veřejný) |
| `KERIO_SERVER`, `KERIO_USERNAME`, `KERIO_PASSWORD` | stdio | — | Schránka pro lokální režim |
| `KERIO_ENABLE_SEND` | stdio | `false` | `true` = povolit odesílání |
| `KERIO_CA_FILE` | oba | — | PEM s firemní certifikační autoritou |
| `KERIO_REQUEST_TIMEOUT_MS` | oba | `30000` | Timeout požadavků na Kerio |
| `KERIO_ALLOW_PRIVATE_NETWORK` | oba | `false` | Jen pro vývoj: povolit Kerio v privátní síti |

## Testy

```bash
npm test                 # build + testy proti simulovanému Kerio API (HTTPS mock), bez skutečné schránky
npm run test:integration # volitelně: jen čtecí test proti skutečnému Keriu (KERIO_SERVER/USERNAME/PASSWORD)
```

Běžné testy pokrývají: čtení zprávy mimo prvních 500, kompletní dlouhý obsah po částech, úplnost filtrů a stránkování,
zakázané odesílání (seznam nástrojů, přímé volání, klientská vrstva, žádné vedlejší změny), zapnuté odesílání, částečný
úspěch, chyby a timeouty bez opakování, ověřování certifikátů, vlastní CA, blokování privátních adres, obnovu relace
a celý OAuth tok včetně PKCE, jednorázových kódů a obnovy tokenů. Žádný test neposílá skutečné e-maily; integrační test
má odesílání vypnuté.

## Co je ověřené a co ne

Vše výše je ověřené **proti simulovanému API** napsanému podle oficiální dokumentace. Proti skutečnému Kerio serveru
zatím nic ověřeno nebylo. Předpoklady, které je potřeba potvrdit na reálném serveru:

1. `Mails.getById` vrací `displayableParts` (text zprávy) a **nemění** stav přečtení.
2. Formát `receiveDate` (předpoklad `20240115T093000+0100` nebo ISO 8601) — důležité pro filtry podle data.
3. `Mails.get` přes více složek najednou řadí podle `receiveDate` sestupně a vrací `totalItems`.
4. Vypršení relace hlásí kódy `-32001`–`-32003` nebo HTTP 401.
5. Formát chyb `Mails.create` při částečném úspěchu (hledá se text „partial“ v kódu nebo zprávě chyby).
6. Kerio přijme odesílanou zprávu s `from` = login (pokud je login e-mailová adresa), jinak bez `from`.

### Postup ověření na skutečném serveru

1. `KERIO_INTEGRATION=1 KERIO_SERVER=… KERIO_USERNAME=… KERIO_PASSWORD=… npm run test:integration`
   (čte nejstarší zprávu v Doručené poště a kontroluje, že se nezměnil stav přečtení; vypíše formát data).
2. V Claude/ChatGPT: vypsat složky, najít starou zprávu podle odesílatele a data, přečíst dlouhou zprávu celou.
3. Ve webmailu zkontrolovat, že přečtená nepřečtená zpráva zůstala nepřečtená.
4. Teprve potom zapnout odesílání a poslat jednu testovací zprávu na vlastní adresu; zkontrolovat Odeslanou poštu.
