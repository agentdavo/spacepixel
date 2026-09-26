# Durable dock transactions

26 September 2026. Market purchases/sales, rearming, dock and Wardens' repairs,
ship purchases/sales/transfers, outfitting and quartermaster fittings now report
success only after saving. A rejected save keeps live credits, cargo, fitted
equipment and hull state unchanged and shows a retryable error. World trade
effects and confirmation sounds follow acceptance.

## Commit boundary

`CareerStore.ts` stores `{ version: 1, ledger, hangar }` under
`vanguard.career.v1`. A refit or repair writes that pair in one `setItem` call,
whose failure leaves the old record intact. There is no two-key partial commit
or rollback window. The first accepted pair operation migrates the career;
the original `vanguard.trade.v1` and `vanguard.hangar.v1` remain untouched.
Loads prefer the pair once present. All existing Profile ledger/hangar writers
then update their half of the same pair, preserving the other half. Before
migration, ordinary ledger operations retain the existing single-key save and
optional pre-expansion-backup quota recovery.

Unreadable, malformed or future-version pair records block subsequent writes
instead of being overwritten with fallback defaults. Legacy migration does
not alter profile, contract, world or expansion stores. Existing future contact
subdocuments survive normalisation and transaction save/load.

Outfitter stages the outgoing owned ship's condition and effective hold size,
saves the candidate pair, then changes the live ship. Ordinary and Wardens'
repairs persist the condition and payment together before changing live hull.
The existing minimum persisted hull condition remains five percent.

`ReplayDirector.transaction` suppresses nested commands and records only an
accepted outfit/repair operation. A failed save cannot turn into a successful
purchase when replayed with the in-memory storage shim. The new repair command
restores the paired condition/payment; the following existing hull command
updates the live ship. Older replay commands and storage snapshots remain
supported.

## Verification

`tests/career-transactions.test.ts` exercises quota failure before/after
migration, failed reads, malformed/future records, reload, retry without double
charge, future contact preservation, paired writers, live Outfitter rejection,
actual Fleet refit application, repair persistence, replay command acceptance,
and market/service UI side-effect ordering. Existing expansion persistence and
outfitting tests remain part of the focused regression set. Native dock UI
fault-injection proof is a separate gate and is not implied by headless tests.

## Scope

This is a single-browser transaction boundary. It does not solve concurrent
editing by multiple tabs or roll back GPU allocation failures after a durable
commit. Guild dues, contracts and world-wide multi-store operations retain their
existing policies and are outside this market/refit change. User-blocked browser
storage still prevents saving; the transaction is rejected visibly rather than
pretending it persisted. Legacy copies are historical after migration and must
not be treated as the current career by external tooling.
