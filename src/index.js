const app = require('@signal24/node-server-foundation');

run();

async function run() {
    const baseDir = process.cwd();

    app.init(baseDir);

    if (process.env.SENTRY_DSN) {
        $sf.sentry.init(process.env.SENTRY_DSN);
    }

    app.registerRoutes(router => {
        router.static('../public');

        router
            .dir('endpoints')
            .register(router => {
                router.ws('ws', 'WS');
            })
    });

    const port = process.env.PORT || 3000;
    if (!/^[0-9]+$/.test(port)) throw new Error('invalid PORT');

    app.start(port, '0.0.0.0');
}