'use strict';

var CONTENT_IDS = {
    SAME_DAY: 'delivery_promise_same_day',
    NEXT_DAY: 'delivery_promise_next_day',
    STANDARD: 'delivery_promise_standard'
};

var MOCK_TIER_BY_US_SKU = {
    '701642819455M': 'SAME_DAY',
    '701642819462M': 'NEXT_DAY',
    '701642819400M': 'STANDARD'
};

/**
 * Validates and normalizes a fulfilment tier.
 * @param {string} tier - Tier returned by the fulfilment service
 * @returns {string|null} Normalized tier or null when invalid
 */
function normalizeTier(tier) {
    if (typeof tier !== 'string') {
        return null;
    }

    var normalized = tier.trim().toUpperCase();
    return CONTENT_IDS[normalized] ? normalized : null;
}

/**
 * Returns PDP configuration without exposing service credentials.
 * @param {string} locale - Current storefront locale
 * @returns {Object} PDP feature context
 */
function getPageContext(locale) {
    var Site = require('dw/system/Site');
    var URLUtils = require('dw/web/URLUtils');
    var currentSite = Site.getCurrent();
    var enabled = currentSite.getCustomPreferenceValue('deliveryPromiseEnabled') === true;
    var localeId = locale && typeof locale === 'object' ? locale.id : locale;
    var countryMatch = String(localeId || '').match(/[_-]([A-Za-z]{2})(?:$|[_-])/);

    return {
        enabled: enabled,
        site: currentSite.ID,
        locale: localeId || '',
        url: enabled ? URLUtils.url('Product-DeliveryPromise').toString() : '',
        country: countryMatch ? countryMatch[1].toUpperCase() : ''
    };
}

/**
 * Gets a tier and its Business Manager-managed content for an in-stock product.
 * @param {string} sku - Product ID
 * @param {string} country - Two-letter ISO country code
 * @returns {Object|null} Rendered promise, or null when no promise is available
 */
function getPromise(sku, country) {
    var Site = require('dw/system/Site');
    var ProductMgr = require('dw/catalog/ProductMgr');
    var ContentMgr = require('dw/content/ContentMgr');
    var Resource = require('dw/web/Resource');
    var Logger = require('dw/system/Logger');
    var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
    var ContentModel = require('*/cartridge/models/content');
    var renderTemplateHelper = require('*/cartridge/scripts/renderTemplateHelper');
    var tier;
    var product;
    var service;
    var result;
    var content;
    var contentFile;
    var contentFileURL;
    var contentModel;
    var mockEnabled;
    var normalizedSku;
    var normalizedCountry;
    var renderedContent;

    if (Site.getCurrent().getCustomPreferenceValue('deliveryPromiseEnabled') !== true) {
        return null;
    }

    if (sku === null || typeof sku === 'undefined'
        || country === null || typeof country === 'undefined') {
        Logger.error('Delivery promise lookup requires both SKU and country');
        return null;
    }

    normalizedSku = String(sku).trim();
    normalizedCountry = String(country).trim().toUpperCase();

    if (!normalizedSku || normalizedSku.length > 100) {
        Logger.error('Delivery promise lookup received an invalid SKU');
        return null;
    }

    if (!/^[A-Z]{2}$/.test(normalizedCountry)) {
        Logger.error('Delivery promise lookup received an invalid country code');
        return null;
    }

    product = ProductMgr.getProduct(normalizedSku);
    if (!product || !product.online
        || product.availabilityModel.getAvailabilityLevels(1).inStock.value < 1) {
        return null;
    }

    mockEnabled = Site.getCurrent().getCustomPreferenceValue('deliveryPromiseMockEnabled') === true;

    service = LocalServiceRegistry.createService('delivery.promise', {
        createRequest: function (svc, params) {
            svc.setRequestMethod('GET');
            svc.setAuthentication('BASIC');
            svc.addHeader('Accept', 'application/json');
            svc.getClient().setTimeout(1800);
            svc.addParam('sku', params.sku);
            svc.addParam('country', params.country);
            return null;
        },
        parseResponse: function (svc, client) {
            try {
                return JSON.parse(client.text);
            } catch (error) {
                Logger.error('Delivery promise service returned invalid JSON: {0}', error.message);
                return null;
            }
        },
        mockFull: function (svc, params) {
            var mockTiers = ['SAME_DAY', 'NEXT_DAY', 'STANDARD'];
            var mockTier = String(params.country).toUpperCase() === 'US'
                && MOCK_TIER_BY_US_SKU[params.sku];

            mockTier = mockTier
                || mockTiers[String(params.sku).charCodeAt(0) % mockTiers.length];

            return {
                sku: params.sku,
                country: params.country,
                tier: mockTier
            };
        }
    });

    if (mockEnabled) {
        service.setMock();
    }

    result = service.call({ sku: normalizedSku, country: normalizedCountry });
    tier = normalizeTier(result && result.object && result.object.tier);
    if (!result.ok || !result.object || !tier) {
        Logger.error('Delivery promise service failed for SKU {0}, country {1}: {2}',
            normalizedSku, normalizedCountry,
            (result.object && result.object.message) || result.errorMessage || 'Invalid service response');
        return null;
    }

    if (String(result.object.sku || '') !== normalizedSku
        || String(result.object.country || '').toUpperCase() !== normalizedCountry) {
        Logger.error('Delivery promise service returned a mismatched SKU or country');
        return null;
    }

    content = ContentMgr.getContent(CONTENT_IDS[tier]);
    if (!content || !content.online) {
        Logger.error('Delivery promise content asset {0} is missing or offline in the site library',
            CONTENT_IDS[tier]);
        return null;
    }

    contentFile = content.custom && content.custom.customCSSFile;
    contentFileURL = contentFile && contentFile.getURL();
    contentModel = new ContentModel(content);
    if (contentModel && contentModel.body) {
        renderedContent = renderTemplateHelper.getRenderedHtml(
            { content: contentModel },
            contentModel.template || 'components/content/contentAssetInc'
        );
    } else if (contentFileURL) {
        renderedContent = renderTemplateHelper.getRenderedHtml({
            imageURL: contentFileURL,
            imageAlt: Resource.msg('deliverypromise.alt.' + tier.toLowerCase(), 'product', null)
        }, 'product/components/deliveryPromiseImage');
    } else {
        renderedContent = null;
    }

    if (!renderedContent) {
        Logger.error('Delivery promise content asset {0} has no renderable body', CONTENT_IDS[tier]);
        return null;
    }

    return {
        tier: tier,
        content: renderedContent
    };
}

module.exports = {
    getPageContext: getPageContext,
    getPromise: getPromise
};
