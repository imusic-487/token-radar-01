# Token Radar — model radar-2

A token launch radar for make.fun's `token-radar-01` bounty. It reads a
sealed DefiLlama snapshot and ranks the pre-token protocols by an implied
value it states, each with a farm plan.

## Model (radar-2)

Only the snapshot's own figures are used — TVL, seven-day growth, age
since first listing, and chain count. No protocol name is special-cased.

```
implied = round( tvl_usd x 0.30
  x (1 + clamp(change_7d, -50, 100) / 100 x 0.6)
  x (0.55 + 0.45 x min(age_days, 730) / 730)
  x (1 + 0.02 x min(chains - 1, 10)) )
```

A protocol is rankable when it records no token (no market cap, no
CoinGecko id, no symbol) and is not a wrapped, staked or bridged product
of a token that already trades. The board holds all 40 watchlist
protocols plus every rankable pre-token protocol below the $50M floor
(138), with no top-N cut: 178 rows. Protocols whose token already
trades are set aside in a Live token view with their market caps.

"Records no token" is DefiLlama's record, not proof: a protocol on the
board may still have a token its record does not carry. The implied
value is the entry's own estimate, not a price, and it predicts nothing
about whether or when a token is issued.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`main.ts` (Node 22, standard library only) writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the
output directory. The dashboard is a static page with no network: open
`out/dashboard/index.html` beside `out/data.js`.
