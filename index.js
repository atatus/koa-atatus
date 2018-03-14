'use strict';

const DEFAULT_STATIC_EXTENSIONS = [
    'svg',
    'png',
    'jpg',
    'gif',
    'css',
    'js',
    'html'
];

const DEFAULT_RENDER_METHOD = 'render';

const EXT_REGEX = /\/[^/]+\.(\w+)$/;

/**
 * Create a atatus middleware.
 * Need to be called before any koa.use & router.register
 *
 * @param {Object} atatus
 *
 * @return {Function}
 */
module.exports = function (atatus) {
    // unwrap wrapped functions if any
    unwrap();
    const renderMethodName = DEFAULT_RENDER_METHOD;

    if (!atatus || typeof atatus !== 'object') {
        throw new Error('Invalid Atatus Agent!');
    }

    // middleware traces
    traceMiddlewares(atatus);

    function setTransactionName(method, path) {
        atatus.setTransactionName('Koajs - ' + method + ' ' + path);
    }

    async function setName(ctx) {
        if (ctx._matchedRoute) {
            // not macthed to any routes
            if (ctx._matchedRoute === '(.*)') {
                return;
            }
            setTransactionName(ctx.method, ctx._matchedRoute);
            return;
        }

        if (ctx.method === 'GET') {
            const extMatch = EXT_REGEX.exec(ctx.path);
            if (extMatch) {
                const [ext] = extMatch.slice(1);
                if (DEFAULT_STATIC_EXTENSIONS.indexOf(ext) !== -1) {
                    setTransactionName(ctx.method, '/*.' + ext);
                }
            }
        }

    }

    return async function koaAtatus(ctx, next) {
        // for patching the render method
        Object.defineProperty(ctx, renderMethodName, {
            configurable: true,
            get() {
                return ctx['_' + renderMethodName];
            },
            set(newRender) {
                ctx['_' + renderMethodName] = async function wrappedRender(...args) {
                    const endTracer = atatus.createLayer('Render ' + args[0], () => {});
                    const result = await newRender(...args);
                    endTracer();
                    return result;
                };
            }
        });

        setName(ctx);

        await next();
    };
};


/**
 * traceMiddlewares
 *
 * Patch
 *   Koa.prototype.use
 *   koa-router.prototype.register
 * to breakdown each middleware/controller usage
 *
 * @param  {Object} atatus - the atatus instance
 */
function traceMiddlewares(atatus) {
    const anonymousMW = [];

    const wrapMiddleware = function (middleware) {
        if (middleware && middleware.name !== 'koaAtatus') {
            // name anonymous middleware
            if (!middleware.name && anonymousMW.indexOf(middleware) === -1) {
                anonymousMW.push(middleware);
            }
            const name = 'Middleware ' + (middleware.name || 'anonymous' + anonymousMW.indexOf(middleware));

            const wrapped = async function (ctx, next) {
                let endTracer;
                if (atatus.agent &&
                    atatus.agent.tracer &&
                    atatus.agent.tracer.getTransaction()) {
                    endTracer = atatus.createLayer(name, () => {});
                }

                const wrappedNext = async function () {
                    if (endTracer) {
                        endTracer();
                    }

                    try {
                        await next();
                    } catch (e) {
                        throw e;
                    } finally {
                        if (atatus.agent &&
                            atatus.agent.tracer &&
                            atatus.agent.tracer.getTransaction()) {
                            endTracer = atatus.createLayer(name, () => {});
                        }
                    }
                };

                try {
                    await middleware(ctx, wrappedNext);
                } catch (e) {
                    throw e;
                } finally {
                    if (endTracer) {
                        endTracer();
                    }
                }
            };

            return wrapped;
        }

        return middleware;
    };
    try {
        const Koa = require('koa');
        const originalUse = Koa.prototype.use;
        Koa.prototype.use = function (middleware) {
            const wrapped = wrapMiddleware(middleware);
            return originalUse.call(this, wrapped);
        };
        Koa.prototype.use._original = originalUse;
        registerWrapped(Koa.prototype, 'use');
    } catch (e) {
        // app didn't use koa
        throw new Error('koa-atatus cannot work without koa!');
    }

    try {
        const Router = require('koa-router');

        const originalRegister = Router.prototype.register;

        Router.prototype.register = function (...args) {
            const middlewares = Array.isArray(args[2]) ? args[2] : [args[2]];

            const wrappedMiddlewares = middlewares.map(middleware => wrapMiddleware(middleware));

            return originalRegister.apply(this, [args[0], args[1], wrappedMiddlewares, args[3]]);
        };
        Router.prototype.register._original = originalRegister;
        registerWrapped(Router.prototype, 'register');
    } catch (e) {
        // app didn't use koa-router
    }
}

const wrappedFunctions = [];

function registerWrapped(obj, name) {
    wrappedFunctions.push({
        obj,
        name
    });
}

function unwrap() {
    while (wrappedFunctions.length) {
        const wrapped = wrappedFunctions.pop();
        const wrappedFunction = wrapped.obj[wrapped.name];
        wrapped.obj[wrapped.name] = wrappedFunction._original;
    }
}