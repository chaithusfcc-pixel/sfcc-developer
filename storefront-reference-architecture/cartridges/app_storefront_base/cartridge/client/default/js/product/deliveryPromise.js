'use strict';

var request;
var requestId = 0;
var CACHE_PREFIX = 'sfra-delivery-promise:';
var SUCCESS_CACHE_TTL = 10 * 60 * 1000;
var FAILURE_CACHE_TTL = 30 * 1000;

/**
 * Checks whether a selected product can receive a delivery promise.
 * @param {Object} product - Selected product model
 * @returns {boolean} Whether the product is orderable and in stock
 */
function isOrderable(product) {
    return product && product.readyToOrder
        && (product.inStock === true || (product.availability && product.availability.inStock === true));
}

/**
 * Displays a loading or fallback message.
 * @param {jQuery} $widget - Delivery promise region
 * @param {string} message - Localized status message
 * @param {boolean} busy - Whether a request is in progress
 */
function setMessage($widget, message, busy) {
    $widget.empty().append(
        $('<span class="delivery-promise-message"></span>').text(message)
    );
    $widget.attr('aria-busy', busy ? 'true' : 'false');
}

/**
 * Loads the content font only when rendered content contains text.
 */
function loadMontserrat() {
    if (document.getElementById('delivery-promise-font')) {
        return;
    }

    var preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = 'https://fonts.googleapis.com';
    document.head.appendChild(preconnect);

    var fontConnect = document.createElement('link');
    fontConnect.rel = 'preconnect';
    fontConnect.href = 'https://fonts.gstatic.com';
    fontConnect.crossOrigin = 'anonymous';
    document.head.appendChild(fontConnect);

    var stylesheet = document.createElement('link');
    stylesheet.id = 'delivery-promise-font';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap';
    document.head.appendChild(stylesheet);
}

/**
 * Creates a cache key scoped to the endpoint, country, and product.
 * @param {jQuery} $widget - Delivery promise region
 * @param {string} sku - Product SKU
 * @returns {string} Session storage key
 */
function cacheKey($widget, sku) {
    return CACHE_PREFIX + $widget.attr('data-url') + ':'
        + $widget.attr('data-site') + ':' + $widget.attr('data-locale') + ':'
        + $widget.attr('data-country') + ':' + sku;
}

/**
 * Reads a non-expired promise response from session storage.
 * @param {string} key - Session storage key
 * @returns {Object|null} Cached response
 */
function getCachedPromise(key) {
    var cached;

    try {
        cached = window.sessionStorage.getItem(key);
        cached = cached && JSON.parse(cached);
    } catch (error) {
        return null;
    }

    if (!cached || cached.expiresAt <= Date.now()) {
        try {
            window.sessionStorage.removeItem(key);
        } catch (error) {
            return null;
        }
        return null;
    }

    return cached;
}

/**
 * Saves a response with its expiry time.
 * @param {string} key - Session storage key
 * @param {string|null} content - Rendered response content
 * @param {number} ttl - Cache lifetime in milliseconds
 */
function saveCachedPromise(key, content, ttl) {
    try {
        window.sessionStorage.setItem(key, JSON.stringify({
            content: content,
            expiresAt: Date.now() + ttl
        }));
    } catch (error) {
        // Storage can be unavailable in private browsing; the live request still works.
    }
}

/**
 * Renders promise content or the localized fallback.
 * @param {jQuery} $widget - Delivery promise region
 * @param {string|null} content - Rendered response content
 */
function renderContent($widget, content) {
    if (!content) {
        setMessage($widget, $widget.attr('data-fallback'), false);
        return;
    }

    $widget.html(content);
    $widget.attr('aria-busy', 'false');
    if ($widget.text().trim()) {
        loadMontserrat();
    }
}

/**
 * Fetches or restores the promise for a SKU without blocking the page.
 * @param {jQuery} $widget - Delivery promise region
 * @param {string} sku - Product SKU
 */
function requestPromise($widget, sku) {
    var country = $widget.attr('data-country');
    var url = $widget.attr('data-url');
    var key;
    var cached;
    var currentRequestId;

    if (!sku || !country || !url) {
        setMessage($widget, $widget.attr('data-fallback'), false);
        return;
    }

    key = cacheKey($widget, sku);
    cached = getCachedPromise(key);
    if (cached) {
        renderContent($widget, cached.content);
        return;
    }

    requestId += 1;
    currentRequestId = requestId;

    if (request && request.readyState !== 4) {
        request.abort();
    }

    setMessage($widget, $widget.attr('data-loading'), true);

    request = $.ajax({
        url: url,
        method: 'GET',
        dataType: 'json',
        data: {
            sku: sku,
            country: country
        },
        timeout: 2200
    }).done(function (response) {
        var content = response && response.content;

        if (currentRequestId !== requestId) {
            return;
        }

        saveCachedPromise(key, content || null, content ? SUCCESS_CACHE_TTL : FAILURE_CACHE_TTL);
        renderContent($widget, content);
    }).fail(function (xhr, status) {
        if (currentRequestId !== requestId || status === 'abort') {
            return;
        }

        saveCachedPromise(key, null, FAILURE_CACHE_TTL);
        renderContent($widget, null);
    });
}

/**
 * Updates the promise after variant selection.
 * @param {jQuery} $widget - Delivery promise region
 * @param {Object} product - Selected product model
 */
function updatePromise($widget, product) {
    requestId += 1;

    if (request && request.readyState !== 4) {
        request.abort();
    }

    if (!isOrderable(product)) {
        setMessage($widget, $widget.attr('data-select-variant'), false);
        return;
    }

    requestPromise($widget, product.id);
}

/**
 * Initializes the PDP promise region and variant-change handler.
 */
module.exports = function () {
    var $widget = $('.delivery-promise').first();

    if (!$widget.length) {
        return;
    }

    if ($widget.attr('data-ready-to-order') === 'true'
        && $widget.attr('data-in-stock') === 'true') {
        requestPromise($widget, $widget.attr('data-pid'));
    }

    $('body').on('product:afterAttributeSelect.deliveryPromise', function (event, response) {
        var $container;
        var $updatedWidget;

        if (!response || !response.container || !response.data || !response.data.product) {
            return;
        }

        $container = $(response.container);
        $updatedWidget = $container.filter('.delivery-promise')
            .add($container.find('.delivery-promise'))
            .first();
        if (!$updatedWidget.length) {
            $updatedWidget = $container.closest('.product-detail').find('.delivery-promise').first();
        }
        if ($updatedWidget.length) {
            updatePromise($updatedWidget, response.data.product);
        }
    });
};
