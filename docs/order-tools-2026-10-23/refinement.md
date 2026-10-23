# Invoice and create-form refinement

- Branded navy/gold PDF header, payment metadata, customer block, aligned item/quantity/unit-price/amount table and clear total. Embedded licensed DejaVu font subsets avoid font substitution. Header/table repeat on long invoices; footer identifies order and page count. Vercel explicitly includes font assets in payment function bundles.
- Optional + Attach image controls appear directly in both create forms, with previews, removal and six-image limit. Photos use the existing private APIs and JPEG re-encoding.
- Case creation commits first. Upload errors retain images and their idempotency keys on the confirmation page. Retry images does not create another case. Uploads are not claimed successful before API confirmation. Selling-case lookup is through the existing authenticated owner-only listing.
- Browser tests on real selling/support pages at 390 and 1440 pixels (mock provider/API responses) passed: select image, create once, simulate upload failure, retry same photo request ID, show confirmation, no page errors or horizontal overflow.
- Invoice PDF rendered and visually reviewed; multi-page PDF and endpoint tests pass. Full regression suite/build run before deployment. No real customer orders or messages created.
- No database schema changes, new fees or payment/auth changes. Draft selected images remain in page memory and are lost on navigation/reload; failed upload messaging asks customers to retry before leaving.
