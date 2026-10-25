# @bookstore/domain

Pure TypeScript with no I/O (TDD §2.3, §3.4). It is shared by the API, the worker and the staff app, including the offline POS.

| File | Contents | Requirements |
| --- | --- | --- |
| `money.ts` | Branded integer `Vnd`, basis points, half-up rounding, exact proportional `allocate`, VND format/parse | BR-01, TDD §3.6 |
| `vat.ts` | VAT contained in VAT-inclusive prices | BR-02 |
| `pricing.ts` | `priceCart`: promotions, tier, category cap, manual discount limit, order-level allocation, points | FR-POS-02/05, FR-PRM, FR-CRM-04/05 |
| `promotions.ts` | Zod promotion rule union and visible state | FR-PRM-01..04 |
| `loyalty.ts` | Tiers, proportional point reversal, expiry | BR-07, BR-08, BR-19 |
| `inventory.ts` | Movement types, moving-average cost, margin flag | FR-INV-03/08, FR-PUR-05 |
| `shift.ts` | Expected cash, denominations, close check | FR-POS-18..19, BR-06 |
| `isbn.ts`, `text.ts`, `phone.ts` | ISBN-10/13, diacritic folding and slugs, E.164 phones | FR-CAT-02/05, SRS §2.5, BR-16 |
| `payment-ref.ts` | Short payment reference the customer types in the transfer note (printed store QR, no QR generated) | FR-POS-06, FR-ORD-08, TDD §8.4 |
| `permissions.ts` | Permission catalogue and default roles | SRS Appendix A |
| `settings.ts` | Typed settings registry with defaults | TDD Appendix A |
| `state-machines.ts`, `docno.ts` | Allowed transitions; document numbers | SRS Appendix B, NFR-REL-02 |

Run `pnpm test` here. The tests include fast-check properties, so rounding never loses a dong and cart totals always equal the sum of their lines.
