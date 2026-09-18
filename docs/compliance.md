# The rules /compliance checks

Six rules a New Zealand wholesale distributor lives under, each checked against the records by `npm run wholesale -- compliance`. Each rule names its source. **Nothing here is legal advice**: it is the rule book the operator has told the system to enforce, and `/customise` changes it when the operator's lawyer or the law says otherwise. Australian equivalents are sketched at the end.

## 1. Taxable supply information complete behind every invoice (`taxable-supply`)

**Source:** Goods and Services Tax Act 1985, ss 19E to 19K, the taxable supply information rules in force since 1 April 2023. Supplies over $200 need the supplier's name, GST number and the date. Supplies over $1,000 also need the recipient's name and at least one identifier, an address being the usual one.

**The check:** draft and sent invoices over $1,000 for customers with no address on file.

**The fix:** `customer set <name> --address="..."`, and your own GST number in `brand.json` so `npm run docs` renders every invoice complete.

## 2. A PPSR financing statement behind every credit account (`ppsr`)

**Source:** Personal Property Securities Act 1999. A retention of title clause in terms of trade is a security interest. Unperfected, it ranks behind every registered creditor: in a customer liquidation, the stock on their floor that your terms say is still yours goes to the bank that registered. Perfection is a financing statement on the PPSR (ppsr.companiesoffice.govt.nz), usually as a purchase money security interest over the goods supplied.

**The check:** active customers holding a credit limit with no PPSR registration date recorded.

**The fix:** register, then `customer set <name> --ppsr=<date>`.

## 3. Signed terms of trade behind every credit account (`trade-terms`)

**Source:** Consumer Guarantees Act 1993 s 43: contracting out of the CGA in a business-to-business supply is effective only if in writing. Fair Trading Act 1986 s 26A: the unfair contract terms regime reaches standard-form small trade contracts. Terms that were never returned signed are the version of your terms a court is free to ignore, and your retention of title clause lives in them.

**The check:** active credit customers with no signed-terms date recorded.

**The fix:** get them returned signed, then `customer set <name> --terms-signed=<date>`.

## 4. Hazardous stock inside the declared storage ceiling (`hazardous`)

**Source:** Health and Safety at Work (Hazardous Substances) Regulations 2017. Holding certain classes above threshold quantities triggers duties: inventory, signage, certified handlers, location compliance certificates. `haz_max_qty` on each hazardous product is the ceiling the operator has declared their site safe and certified for.

**The check:** hazardous products whose total on hand exceeds their declared ceiling. The seed ships with a breach on purpose: 84 drums of class 8 degreaser against a ceiling of 60.

**The fix:** move or return stock (`adjust`, with its reason), or extend the site's certification and raise the ceiling (`product set <sku> --haz-max=`). The check is only as good as the ceilings declared; declaring none is a choice the walk-around will not respect.

## 5. Nothing shipped at more than the price on the list (`pricing`)

**Source:** Fair Trading Act 1986 s 13(g): false or misleading representations about price. A customer on an agreed price list who is invoiced above it has been misled about the price, fat finger or not.

**The check:** the last 28 days of shipped lines, each compared against the price that customer should have been charged (their price, then their tier, then the list).

**The fix:** credit the overcharge in your accounting system, or bring a stale list up to the agreed reality: `price set <sku> --price= --customer=`.

## 6. Every stock adjustment explains itself (`records`)

**Source:** Companies Act 1993 s 194: accounting records must correctly record and explain the company's transactions. An unexplained write-off is also the first thing any shrinkage investigation, stocktake variance review or audit asks about.

**The check:** the last 30 days of adjustments with no reason recorded. The CLI refuses new reasonless adjustments at the gate, so this list only grows from imports and history.

**The fix:** `adjust reason <move-id> "what actually happened"`.

## Australia, at a high level

The same shape holds across the Tasman with different statutes: tax invoices under the A New Tax System (Goods and Services Tax) Act 1999 (s 29-70 sets the required contents), retention of title registration on the PPSR under the Personal Property Securities Act 2009 (Cth), unfair contract terms and misleading pricing under the Australian Consumer Law (Competition and Consumer Act 2010, Schedule 2), hazardous chemicals under the model WHS Regulations' hazardous chemicals part, and record-keeping under s 286 of the Corporations Act 2001. Ask Claude Code to rebuild this file and the checks on those sources, then have someone qualified read it.
