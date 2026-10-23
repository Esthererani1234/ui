# Legal research and decision memorandum

**Prepared October 23, 2026 — draft for licensed New York counsel.** This is research and implementation preparation, not a legal opinion, an attorney-client engagement, or certification of compliance. Recheck authorities immediately before adoption. A statute’s application depends on transaction facts, jurisdiction and later developments. Source URLs below were retrieved or searched in this review; failed full-text retrieval is identified. Original drafts use these sources as guidance, not copied dealer clauses.

## Findings and proposed decisions

| Priority | Finding | Proposed response / approval required |
|---|---|---|
| Launch blocker | Exact legal entity, formation state, DBA, notice address and authorized signatory not independently verified. Existing site says Gold On The Spot LLC; owner's Wyoming/NYC description is not a registry certificate. | Obtain formation certificate, good standing/NY foreign qualification analysis, DBA evidence if applicable, business notice address and bank-beneficiary match. Draft placeholders must not reach publication. |
| Launch blocker | Production `card_surcharge_percent=4`; generic card quote calculated before funding type is known. | Visa primary rules prohibit debit/prepaid surcharges and cap eligible credit surcharges at the lower of applicable MDR and 3%; NY GBL518 requires compliant total disclosure and cost limits. Obtain processor/counsel approval and choose no surcharge or a properly supported model. No live setting changed in this task. |
| Launch blocker | No authoritative tax engine found in checkout; NY registration certificate not verified. | CPA must approve product/destination/tax rules and registration. Unknown treatment must block acceptance, not default to 0%. Stripe Tax presence, coverage and product classifications must be verified; do not assume enabling it solves bullion exemptions. |
| High | Existing agreement can infer acceptance from paid/processing; `accept_wire_order` means customer wire assent, not definitive Company acceptance. | Separate contract status from payment and fulfillment. Preserve old orders. Explicit acceptance notice and exact immutable archive for new approved version only. |
| High | Wire deadline currently based on placement/customer assent, not the proposed two business days after Company acceptance. | Approve receiving-bank calendar and 5PM Eastern cutoff; show concrete deadline and re-consent if it changes. Draft-only helper supplied. |
| High | Current general terms have version/time fields; no complete new bundle archive and separately issued acceptance event. | Proposed private append-only evidence tables, exact text + hashes + event ledger + customer retrieval adapter. A database hash is not tamper-proof against a database superuser; require separately controlled backups/immutable copies and access logs. |
| High | Insurance scope, exclusions, carrier limits and dispatch capacity unverified. | Do not promise full insurance. Verify policy for bullion, actual shipment value and signature arrangements; establish ship-by monitoring and FTC delay workflow. |
| High | AML/sanctions applicability and operating controls unverified. | Assess actual supplier status, annual purchases/sales and sources; appoint responsible staff and implement required program. Do not claim compliance from a website paragraph. |
| High | Account deletion/retention and marketing consent/suppression lack verified complete operational workflow. | Implement controlled request queue, verification, legal holds, vendor tasks and suppression enforcement before policy commitments. Do not enable marketing from a profile boolean alone. |
| High | No sandbox end-to-end test of revised acceptance/capture/refund lifecycle. | Keep prototype disconnected; integrate and test isolated Stripe and database environment after legal approval. Current auto capture is enabled (`card_manual_capture_enabled=false`). |
| High | Prior audit found native Supabase password recovery path not fully governed by custom SMS, and backup/restore evidence missing. | Separate engineering release gates; no claim these were resolved by legal documents. |

## Dealer comparison (benchmarks, not enforceability conclusions)

**APMEX:** Its user agreement makes a confirmation number significant to binding formation, generally requires receipt within five business days, and describes market loss plus the greater of $50 or 5%. Some cancellation paragraphs still reference $50 alone, creating internal inconsistency. Its general return period is seven days, with stated fees and restrictions. It proposes AAA commercial arbitration in Delaware and individual proceedings. Those terms are neither adopted nor treated as safe for this New York consumer business. [B1]

**Money Metals:** The reviewed disclosure treats submission as an offer and written confirmation as acceptance, states a $50 default fee plus losses, and describes a three-day dissatisfaction notification period with possible restocking charges. Its current page contains an individual/class waiver and Idaho-law provisions; the retrieved page did not contain an arbitration provision. Do not claim it requires arbitration. Its short shipping-claim limits and discretionary remedies are not copied. A single universal customer wire deadline was not established from this page; obtain current checkout/payment terms before quoting one as a benchmark. [B2]

The proposed Gold On The Spot design uses explicit acceptance, no fixed default fee, no discretionary market-based return after acceptance, a nonforfeiture 48-hour preferred report period, and a dormant separate consumer-arbitration proposal. Dealer practices do not supply legal approval for penalties, broad liability waivers or refund restrictions.

## Contract formation and proof

NY UCC2-201,2-204 and2-206 address writing/signature and agreement formation. E-SIGN and NY ESRA recognize electronic records/signatures but do not make every checkbox sufficient for every consumer disclosure. Use conspicuous links, unchecked affirmative assent and retention of exact text, quote and display version. A record must connect the identified customer and commercial terms with the affirmative action. Electronic delivery consent for legally required written disclosures needs its own applicable disclosures/access demonstration. [L1–L4]

NY Court of Appeals *Wu v Uber* addresses conspicuous clickwrap assent; do not rely on browsewrap or an obscure footer for purchase obligations. Counsel should examine the full opinion and interface evidence. A timestamp alone does not prove what the customer saw. Preserve versioned rendered examples and server-generated records. Existing agreements cannot simply be overwritten. [L5]

The proposed ten-minute offer acceptance window intentionally avoids a perpetual stale-price option while staff review occurs. If review cannot finish, a renewed quote and new assent are necessary. Counsel/owner may approve a different finite offer window with explicit disclosure, but it must not silently extend the temporary quote. Acceptance is a contract decision, not a synonym for payment, risk clearance or shipment.

## Default loss, damages and collections

NY UCC2-718 permits reasonable liquidated damages, not an unreasonably large penalty; its deposit restitution rule is not authority for automatically charging $500 or 20%. Section2-706 requires good faith and commercially reasonable resale with applicable notice;2-708 uses its own time/place measure and alternatives;2-710 concerns reasonable incidental damages. Counsel must choose a lawful measure based on evidence rather than selecting whichever formula is largest. Avoid duplicated hedge expenses, avoided shipping, overlapping recovery and unsupported collection charges. [L6–L9]

*JMD Holding* addresses disproportionate liquidated damages and actual damages if a penalty provision fails. No expense study or predicted-loss evidence supports a fixed fee here, so the draft adopts none. An “administration fee” label does not cure a penalty. Collection/legal fees require a contractual/statutory basis and consumer-law review; the draft does not create automatic loser-pays. Deposit offsets require separate restitution review. [L10]

## Returns, shipping, liability and interruption

NY GBL218-a requires proper return-policy disclosure; conspicuous product/checkout disclosure is needed in addition to a policy page. Preserve nonconformity, misdescription, counterfeit, non-delivery and mandatory remedies. NY UCC2-719 limits remedy exclusions, including essential-purpose and unconscionability issues. Proposed liability caps are negotiating drafts, with broad nonwaivable exceptions; counsel must approve them for this consumer setting. [L11–L12]

The FTC internet-order rule requires a reasonable basis for shipping promises, prescribed delay options/consent, and timely refunds. Proposed three-to-seven-day dispatch wording cannot be used to postpone the statutory clock indefinitely while “review” remains open. Determine the legally relevant properly completed-order date, record a ship-by deadline, send timely compliant notices, and refund when required. A carrier insurance investigation must not indefinitely delay a seller remedy. [L13]

NY UCC2-509 risk rules depend on contract and delivery facts. The draft proposes destination responsibility rather than automatic carrier-handoff risk transfer. UCC2-615 does not excuse every supplier issue or price movement; force majeure requires a genuine qualifying event and appropriate notice/mitigation/remedies. [L14–L15]

## Card and crypto

Preserve Truth in Lending/Regulation Z billing-error rights; issuer/network remedies may differ or extend beyond statutory processes. Do not reduce every claim to a 48-hour report deadline. Review Stripe account permissions, capture model, webhook signature/amount checks and actual processor rules before implementing fees or off-session collections. [L16–L18]

Crypto is disabled and has no approved launch tokens/networks. NYDFS states a merchant exception for use solely to purchase/sell goods or services, but actual custody, exchange or transmission activity needs separate analysis. Sanctions apply regardless of the payment rail. Proposed refunds use a disclosed USD entitlement converted at refund time only if owner, provider and counsel approve; never retroactively choose a favorable basis. [L19–L20]

## AML, sanctions and secondhand purchases

Current 31CFR1027 includes silver as well as listed gold/platinum-group metals at qualifying purity. Determine dealer thresholds and retailer/source exclusions from the actual current rule, not a simplified “all bullion dealers” statement. Evaluate purchases from consumers, foreign sources and others outside covered dealer/retailer categories. Required programs include risk-based controls, responsible compliance personnel, training and independent testing; a Terms page is not a program. [L21–L22]

IRS Form8300 rules apply to qualifying cash/related transactions; an ordinary bank wire is not cash for that reporting rule. Do not invent a rule that every $10,000 wire must be reported on8300. Reassess if cash or other instruments are later accepted. OFAC review requires a process for potential matches, blocked versus rejected property and reporting; do not automatically refund blocked property. [L20,L23]

NYC secondhand-dealer requirements may apply before buying used goods, but official materials also describe exemptions, including exclusively online activity. Verify the actual operation (physical receipt/inspection, customer visits, scrap purchases) and exact exemption with DCWP/counsel. Inquiry-only launch creates no automatic buying/refining authority. Other-state purchasing laws need review before expanding beyond inquiries. [L24]

## Taxes and state applicability

NY Tax1115(a)(27) uses **more than $1,000**, not “$1,000 or more,” with investment/form and price conditions. The statutory premium limits differ: silver coins140%, small gold coins120%, other coins115%, bars/ingots115%, against the specified comparison reference; it is not always a live spot comparison. It also references registration under GBL359-e if required, so counsel should assess that cross-reference. An LLC's Wyoming formation does not remove NYC operational tax obligations. [L25–L26]

No 50-state tax exemption conclusion is certified here. A prepared jurisdiction register marks all50states andDC unapproved until a CPA supplies nexus, registration, product rules, shipping tax, threshold aggregation and effective dates. Do not collect where not required or authorized merely because a software rate exists; do not exempt where uncertain. Territories need their own decision and are not implicitly enabled. Refunds must reverse correctly calculated tax.

## Privacy, incidents and marketing

SHIELD Act safeguards apply based on the handling of New Yorkers’ private information, independently of broad state privacy-law revenue thresholds. Current GBL899-aa includes notification timing no later than30days after discovery, subject to statutory exceptions; counsel must assess triggers, discovery, law-enforcement delays and required regulator notices, including current agency requirements. Do not wait for a complete forensic investigation before tracking deadlines. Data processors have their own prompt notification obligations. [L27–L28]

California and other state comprehensive privacy statutes have differing thresholds, rights and exceptions; counsel must assess actual revenue/volumes/business activities. Existing first-party analytics honors GPC/DNT and browser opt-out, but this is not certification of every statutory opt-out. Map vendor contracts, sensitive data, agent verification, appeals and deletion across backups. [L29]

CAN-SPAM requires appropriate sender/subject information, a valid postal address and functioning opt-out; federal rules are not a universal opt-in statute, but the Company proposes stricter affirmative optional marketing consent. Use separate email and SMS consent, never bundled with purchasing. TCPA/FCC rules and state telemarketing laws require current review before marketing texts. January2026DA26-12 extended a limited revocation waiver, but research also identified September/October2026 developments; the final FCC26-67 PDF could not be retrieved (403). Do not rely on the January extension alone or present the September draft as final law. Counsel must verify the final order, effective dates and current47CFR64.1200. Suppress marketing promptly on request as the conservative operational design. No marketing was activated. [L30–L33]

## Arbitration uncertainty

FAA9USC2 supports covered written arbitration agreements subject to defenses and statutory exceptions. NYGBL399-c restricts certain consumer clauses; federal preemption is fact-dependent. The2025 *Zinna* decision notes FAA was not argued there; it is not a universal holding that FAA arbitration cannot apply in New York. The draft uses AAA Consumer Rules, an opt-out, fair costs, court formation review, small claims and nonwaivable exceptions rather than transplanting a dealer’s commercial rules. AAA registration/administration must be verified. No clause is active. [L34–L37]

## Source register

- B1 APMEX User Agreement: https://www.apmex.com/useragreement
- B2 Money Metals legal disclosures: https://www.moneymetals.com/privacy/legal-disclosures
- L1 NY UCC2-201: https://www.nysenate.gov/legislation/laws/UCC/2-201
- L2 NY UCC2-204 and2-206: https://www.nysenate.gov/legislation/laws/UCC/2-204 ; https://www.nysenate.gov/legislation/laws/UCC/2-206
- L3 E-SIGN15USC7001: https://uscode.house.gov/view.xhtml?req=(title:15%20section:7001%20edition:prelim)
- L4 NY ESRA304: https://www.nysenate.gov/legislation/laws/STT/304
- L5 *Wu v Uber*,2024: https://www.nycourts.gov/reporter/3dseries/2024/2024_05869.htm
- L6 NY UCC2-718: https://www.nysenate.gov/legislation/laws/UCC/2-718
- L7 NY UCC2-706: https://www.nysenate.gov/legislation/laws/UCC/2-706
- L8 NY UCC2-708: https://www.nysenate.gov/legislation/laws/UCC/2-708
- L9 NY UCC2-710: https://www.nysenate.gov/legislation/laws/UCC/2-710
- L10 *JMD Holding*,2005: https://www.nycourts.gov/reporter/3dseries/2005/2005_02565.htm
- L11 NY GBL218-a: https://www.nysenate.gov/legislation/laws/GBS/218-A
- L12 NY UCC2-719: https://www.nysenate.gov/legislation/laws/UCC/2-719
- L13 FTC business guide: https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule
- L14 NY UCC2-509: https://www.nysenate.gov/legislation/laws/UCC/2-509
- L15 NY UCC2-615: https://www.nysenate.gov/legislation/laws/UCC/2-615
- L16 CFPB Regulation Z1026.13: https://www.consumerfinance.gov/rules-policy/regulations/1026/13/
- L17 Visa merchant surcharge rules: https://usa.visa.com/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf
- L18 NY GBL518: https://www.nysenate.gov/legislation/laws/GBS/518
- L19 NYDFS virtual-currency guidance: https://www.dfs.ny.gov/virtual_currency_businesses
- L20 OFAC crypto FAQ560: https://ofac.treasury.gov/faqs/560 ; blocked currency FAQ646: https://ofac.treasury.gov/faqs/646
- L21 Current precious-metals dealer regulation: https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1027
- L22 FinCEN dealer guidance: https://www.fincen.gov/resources/statutes-regulations/guidance/guidance-dealers-including-certain-retailers-precious
- L23 IRS8300 reference: https://www.irs.gov/businesses/small-businesses-self-employed/irs-form-8300-reference-guide
- L24 NYC DCWP checklist: https://www.nyc.gov/site/dca/businesses/license-checklist-secondhand-dealer-general.page ; official exemption summary: https://nyc-business.nyc.gov/nycbusiness/description/secondhand-dealer-general-license
- L25 NY Tax1115: https://www.nysenate.gov/legislation/laws/TAX/1115
- L26 NY GBL359-e: https://www.nysenate.gov/legislation/laws/GBS/359-E
- L27 NY breach law: https://www.nysenate.gov/legislation/laws/GBS/899-AA
- L28 NY safeguards: https://www.nysenate.gov/legislation/laws/GBS/899-BB ; NYAG SHIELD guidance: https://ag.ny.gov/resources/organizations/data-breach-reporting/shield-act
- L29 California AG privacy rights: https://oag.ca.gov/privacy/ccpa
- L30 FTC CAN-SPAM: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- L31 FCC DA26-12: https://www.fcc.gov/document/cgb-extends-effective-date-tcpas-consent-revocation-rule
- L32 FCC September draft (not final): https://docs.fcc.gov/public/attachments/DOC-424844A1.pdf
- L33 Identified final-order URL, full text retrieval blocked403: https://docs.fcc.gov/public/attachments/FCC-26-67A1.pdf — verify independently before reliance.
- L34 FAA9USC2: https://uscode.house.gov/view.xhtml?req=(title:9%20section:2%20edition:prelim)
- L35 NY GBL399-c: https://www.nysenate.gov/legislation/laws/GBS/399-C
- L36 *Zinna*,2025: https://www.nycourts.gov/reporter/3dseries/2025/2025_50072.htm
- L37 AAA consumer rules/fees: https://www.adr.org/rules-forms-and-fees/consumer/

Government law text and judicial opinions are distinguished from copyrighted dealer policies. Dealer summaries are limited; no policy text was copied into the draft agreements. This research does not certify a nationwide license, tax or privacy conclusion, nor resolve the identified FCC current-text retrieval gap.
