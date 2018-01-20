# koa-atatus

Koa middleware to allow Atatus monitor **Koa 2.x** applications like Express.

## Installation
```
npm install koa-atatus
```

## API

You must add the koa-atatus middleware to every koa router instance before defining the routes.

```javascript
const atatus = require("atatus-node");
atatus.start({
    apiKey: 'YOUR_API_KEY',
});
const koaAtatus = require('koa-atatus')(atatus);

const Koa = require('koa'),
    Router = require('koa-router');

const app = new Koa();
const router = new Router();
router.use(koaAtatus);      // This line should be added for every router instance.

// Routes
router.get('/', async function (next) {...});

// For error capturing
app.on('error', (err, ctx) => {
    atatus.notifyError(err);
});

app.use(router.routes());
app.listen(3000);
```

## License
Copyright (c) 2018 Atatus

Licensed under the MIT license.