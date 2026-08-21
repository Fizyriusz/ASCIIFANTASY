# Szablon zlecenia

Kopiuj do nowego pliku `M<n>-<nazwa>.md`. Zlecenie ma być samowystarczalne:
Claude Code czyta `CLAUDE.md` + ten plik i nie potrzebuje niczego dopytywać.

---

## Cel

Jedno zdanie: co po tym zadaniu jest możliwe, co nie było.

## Zakres

### Wolno dotykać
```
<lista plików>
```

### Nie dotykać
```
<lista plików + powód>
```

## Co ma powstać

Dla każdego modułu: sygnatury wejścia i wyjścia, algorytm w punktach,
punkty krytyczne z uzasadnieniem *dlaczego* tak, a nie inaczej.

## Definicja ukończenia

1. typecheck / test / test:snap zielone
2. snapshoty: `<lista nazw>` — co dowodzi każdy z nich
3. budżet: `<metryka> < <limit>` mierzone przez `pnpm bench`
4. zero alokacji w hot path (jeśli dotyczy) + dowód
5. `pnpm dev` pokazuje: `<obserwowalny efekt>`
6. podsumowanie w formacie z CLAUDE.md

## Czego świadomie NIE robimy

Lista rzeczy, które kuszą, a należą do kolejnych milestone'ów.

## Pułapki

Konkretne błędy, których się spodziewamy, z objawem („tekstura pływa",
„dziura o jeden wiersz"), żeby dało się je rozpoznać po obrazie.
