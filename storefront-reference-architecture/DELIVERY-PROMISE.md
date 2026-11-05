# Delivery promise on the PDP

## Technical overview

The delivery-promise block appears below product availability on the standard and
Page Designer PDPs. It is controlled by the `deliveryPromiseEnabled` site
preference and defaults to off.

When a selected product is ready to order and has any inventory in stock, the
browser makes a separate request to `Product-DeliveryPromise` with the selected
variant SKU and the country derived from the current locale. The server verifies
that the product is online and in stock, calls the `delivery.promise` HTTP
service, validates the returned SKU, country, and tier, then renders the matching
content asset:

| Service tier | Business Manager content ID |
| --- | --- |
| `SAME_DAY` | `delivery_promise_same_day` |
| `NEXT_DAY` | `delivery_promise_next_day` |
| `STANDARD` | `delivery_promise_standard` |

The fulfilment response must be JSON in this form:

```json
{
  "sku": "selected-variant-sku",
  "country": "US",
  "tier": "SAME_DAY"
}
```

The service uses HTTP Basic Authentication configured as a BM service
credential. Credentials remain server-side; they are not sent to the browser.
The normal PDP and `Product-Variation` response do not wait for the service.
Service errors, invalid responses, missing/offline content, and request timeouts
show a localized fallback instead of breaking the PDP.

Successful responses are cached in browser session storage for 10 minutes;
failures are cached for 30 seconds. The key includes the endpoint, site, locale,
country, and SKU. The loading and fallback messages use a polite live region.
The widget reserves responsive space while loading. Montserrat is requested
from Google Fonts only after text content is rendered; deployments with a Content
Security Policy must permit `fonts.googleapis.com` and `fonts.gstatic.com`.

## SFCC configuration

1. Import [`metadata/system-objecttype-extensions.xml`](./metadata/system-objecttype-extensions.xml)
   and [`metadata/services.xml`](./metadata/services.xml) into the target
   instance.
2. In **Administration > Operations > Services**, configure the
   `delivery.promise.credentials` URL, user ID, and password. Replace the sample
   endpoint with the fulfilment provider's endpoint, then enable the
   `delivery.promise` service. Keep production credentials in BM, not source
   control.
3. In the site's custom preferences, enable **Enable PDP delivery promise**.
   Leave **Use mocked delivery promise response** disabled for the real service.
   Set it to enabled only for mock-based testing.
4. Ensure the site's assigned content library contains all three content IDs.
   The definitions are in
   [`libraries/RefArchSharedLibrary/library/library.xml`](./libraries/RefArchSharedLibrary/library/library.xml).
   Import the associated media file for the SAME_DAY `customCSSFile` attribute
   into that library as well.

The mock mode does not call the external service. It has explicit US SKU examples
for the three tiers and assigns other SKUs deterministically; it is for
integration testing, not production delivery decisions.

## Business Manager content authoring

Business users can change tier messaging without deploying storefront code:

1. Open the content library assigned to the site and edit the asset matching the
   fulfilment tier.
2. Add or update the asset body to manage copy, images, and styling using the
   content editor's HTML/source mode. When a body is present it is rendered in
   preference to the optional `customCSSFile` image.
3. If no body is configured, the storefront displays the asset's
   `customCSSFile` image as a fallback. Its localized alternative text is
   generated from the delivery tier.
4. Keep each asset online and publish the library changes. Confirm the
   corresponding fulfilment tier maps to the intended asset.

The content is rendered below availability using responsive storefront styles.
Text content uses Montserrat; lettering baked into fallback images cannot be
restyled by the storefront.

## PDP validation example

Use the RefArch product page below to verify variant selection and the delivery
promise block:

[Extend Tab Straight Leg Pant — RefArch](https://bdcl-001.my.commercecloud.salesforce.com/s/RefArch/extend-tab-straight-leg-pant/25518009M.html?lang=en_US)

## Test steps

### Prepare Business Manager

1. Confirm the site has **Enable PDP delivery promise** enabled.
2. For a live-service test, disable **Use mocked delivery promise response** and
   confirm the `delivery.promise` service and credentials are configured.
   Alternatively, enable the mock preference for a test that does not call the
   external service.
3. Confirm the site-assigned content library has the three tier assets online.
   For each asset, verify its body or fallback `customCSSFile` image is present.
4. Open the PDP validation example in a fresh browser tab. Use DevTools Network
   and Console; clear session storage if you need to observe a fresh request
   rather than a cached result.

### Verify variant-to-tier rendering

1. Before selecting a size, confirm the availability area asks for options and
   the delivery block prompts the shopper to select available options. No
   fulfilment request should be sent yet.
2. Select an available size and confirm the variation request completes. If the
   variant is in stock, verify a separate `Product-DeliveryPromise` request
   includes that selected variant's `sku` and the locale country (`US` for this
   page).
3. Confirm the block below availability shows content for the returned tier:
   `SAME_DAY`, `NEXT_DAY`, or `STANDARD`. Compare the displayed asset with the
   matching content ID in the tier mapping table above.
4. Repeat with sizes that return the other tiers. On this sample PDP, sizes 4,
   6, and 10 were observed returning NEXT_DAY, SAME_DAY, and STANDARD,
   respectively; inventory or service mappings may change.
5. Select an unavailable or non-orderable variant, if one is available, and
   verify no delivery content is presented as an in-stock promise.

### Verify caching and resilience

1. Select a variant, then select another variant and return to the first one.
   Within the 10-minute success-cache period, the first variant's content should
   be restored without another fulfilment request.
2. For a failure test, use a test endpoint or controlled service stub that
   delays for 3–5 seconds or returns HTTP 500. Do not introduce the delay in the
   production service.
3. Confirm the variation request and PDP remain responsive while the delivery
   request is slow. Once the delivery request fails or times out, verify the
   localized fallback appears and the PDP remains usable.
4. Repeat the same failing variant within 30 seconds and verify the failure
   cache prevents an immediate repeat service call.

### Verify responsive, accessible, and flag behavior

1. Repeat variant selection at desktop and mobile viewport widths. Confirm the
   block and image fit their container with no horizontal scrolling.
2. Inspect the block: it should be below availability and expose `role="status"`,
   `aria-live="polite"`, and an accurate `aria-busy` value while loading.
   Confirm image fallback alt text describes the delivery tier.
3. When testing text-based asset bodies, confirm their computed font is
   Montserrat. Image-baked lettering cannot be verified or restyled as a
   storefront webfont.
4. Disable **Enable PDP delivery promise**, reload the PDP, and confirm the
   block is absent and no `Product-DeliveryPromise` request is made. Re-enable
   the preference after the test.
5. Check the browser console for JavaScript errors and the Network panel for
   unexpected failures. Ignore unrelated baseline issues only after verifying
   they are outside the delivery-promise feature.
