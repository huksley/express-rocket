const logger = require('./lib/logger')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const app = express()
const path = require('path')
const port = process.env.PORT || 3000
const bodyParser = require('body-parser')
const serverless = require('serverless-http')
const cookieParser = require('cookie-parser')
const nocache = require('nocache')
const session = require('express-session')
const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy
const { middleware: checkToken, signToken } = require('./lib/token')
const MongoDBStore = require('connect-mongodb-session')(session)
const LocalStrategy = require('passport-local').Strategy
const ejs = require('ejs')
const { User } = require('./lib/user')
const dao = require('./lib/dao')

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
ejs.rmWhitespace = true
ejs.openDelimiter = '{'
ejs.closeDelimiter = '}'

const launch = options => {
  options = options ? options : {}
  const content = options.content ? options.content : {}
  options.content = content
  app.options = options

  const url = process.env.MONGO_URL
  if (!url) {
    throw new Error('MONGO_URL not defined')
  }
  const mongoUrl = url
    .replace('$MONGO_PASSWORD', process.env.MONGO_PASSWORD)
    .replace('$MONGO_USER', process.env.MONGO_USER)

  var store = new MongoDBStore({
    uri: mongoUrl,
    collection: (options.modelPrefix || 'Rocket') + 'Sessions',
    expires: 1000 * 60 * 60 * 24 * 30, // 1 day in milliseconds
    connectionOptions: {
      bufferMaxEntries: 0,
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000
    }
  })

  app.use(
    session({
      resave: false,
      saveUninitialized: false,
      secret: process.env.SESSION_SECRET,
      store: store
    })
  )

  app.use(
    helmet.hsts({
      maxAge: 31536000,
      includeSubDomains: false
    })
  )

  app.use(
    helmet.referrerPolicy({
      policy: 'origin-when-cross-origin'
    })
  )

  app.use(passport.initialize())
  app.use(passport.session())
  app.locals.livereload = !!global.livereload

  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`
  const allowlist = process.env.BASE_URL
    ? [`http://localhost:${port}`, process.env.BASE_URL]
    : [`http://localhost:${port}`]
  const STRATEGY = process.env.PASSPORT_STRATEGY || 'local'

  const config = {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: baseUrl + '/auth/google/callback'
  }

  // Include request parsers
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: false }))
  app.use(cookieParser())
  app.disable('etag')

  app.use(
    cors((req, callback) => {
      if (allowlist.indexOf(req.header('Origin')) !== -1) {
        callback(null, { origin: true })
      } else {
        if (req.header('Origin') !== undefined) {
          logger.warn('Blocked origin', req.header('Origin'))
        }
        callback(null, { origin: false })
      }
    })
  )

  if (options.staticPath) {
    app.use(express.static(options.staticPath))
  }

  // Mount the static files directory
  app.use(express.static(path.join(__dirname, 'public')))

  app.get('/', async (req, res) => {
    res.render('index', {
      baseUrl,
      session: req.session,
      user:
        req.session.passport && req.session.passport.user && req.session.passport.user.token
          ? req.session.passport.user
          : undefined,
      title: content.title ? content.title(req, res) : 'Example',
      content: content.index ? await content.index(req, res) : undefined,
      options
    })
  })

  const knownPage = /faq|changelog|privacy|tos|feedback|support|sandbox|pricing/g
  app.get('/:page', async (req, res, next) => {
    const page = req.params.page
    if (page.match(knownPage)) {
      const contentFunc = content[page]
      res.render('index', {
        baseUrl,
        session: req.session,
        user:
          req.session.passport && req.session.passport.user && req.session.passport.user.token
            ? req.session.passport.user
            : undefined,
        title: content.title ? content.title(req, res) : page,
        content: contentFunc ? await contentFunc(req, res) : '<h1>' + page + '</h1> No such page: ' + page,
        options
      })
    } else {
      next()
    }
  })

  app.get('/dashboard(/*)?', async (req, res) => {
    res.render('dashboard', {
      baseUrl,
      session: req.session,
      user:
        req.session.passport && req.session.passport.user && req.session.passport.user.token
          ? req.session.passport.user
          : undefined,
      title: content.title ? content.title(req, res) : 'User',
      content: content.dashboard ? await content.dashboard(req, res) : undefined,
      options
    })
  })

  app.checkToken = checkToken
  app.dao = dao.define
  app.checkAuth = (req, res, next) => {
    if (req.session && req.session.passport && req.session.passport.user) {
      next()
      return
    }

    checkToken(req, res, next)
  }
  app.findUser = User.find

  app.crud = (prefix, dao, options) => {
    options = options || {}
    const mw = options.middleware ? options.middleware : (_req, _res, next) => next()
    app.get(prefix, mw, async (req, res) => {
      const records = await dao.filter({ ...(options.filter && options.filter(req)) })
      logger.verbose('Listing', dao.name)
      res.status(200).json(records.map(dao.json))
    })

    app.post(prefix, mw, async (req, res) => {
      const { body } = req
      const obj = { ...body, ...(options.required && options.required(req)) }
      logger.verbose('Adding', obj)
      const created = await dao.create(obj)
      res.status(200).json({ ...dao.json(created) })
    })

    app.get(prefix + '/:id', mw, async (req, res) => {
      const id = req.params.id
      const filter = { _id: id, ...(options.required && options.required(req)) }
      logger.verbose('Getting', filter)
      const obj = await dao.find(filter)
      if (obj === undefined) {
        res.status(404).json({ message: 'Not found' })
      } else {
        res.status(200).json({ ...dao.json(obj) })
      }
    })

    app.patch(prefix + '/:id', mw, async (req, res) => {
      const id = req.params.id
      const { body } = req
      const filter = { _id: id, ...(options.required && options.required(req)) }
      logger.verbose('Updating', filter)
      const obj = await dao.find(filter)
      if (obj === undefined) {
        res.status(404).json({ message: 'Not found' })
      } else {
        const obj = await dao.upsert(filter, { ...filter, ...body })
        res.status(200).json({ ...dao.json(obj) })
      }
    })

    app.delete(prefix + '/:id', mw, async (req, res) => {
      const id = req.params.id
      const filter = { _id: id, ...(options.required && options.required(req)) }
      logger.verbose('Deleting', filter)
      const obj = await dao.find(filter)
      if (obj === undefined) {
        res.status(404).json({ message: 'Not found' })
      } else {
        await dao.delete(id)
        res.status(204).send(null)
      }
    })
  }

  app.userCrud = (prefix, dao, options) => {
    const updatedOptions = {
      middleware: app.checkAuth,
      filter: req => ({ userId: req.auth ? req.auth.userId : req.session.passport.user.userId }),
      required: req => ({
        userId: req.auth ? req.auth.userId : req.session.passport.user.userId
      }),
      ...options
    }
    app.crud(prefix, dao, updatedOptions)
  }

  if (options.apis) {
    options.apis(app, options)
  }

  app.get('/error', async (req, res) => {
    res.render('error', {
      baseUrl,
      session: req.session,
      user:
        session.passport && session.passport.user && session.passport.user.token
          ? session.passport.user
          : undefined,
      title: content.title ? content.title(req, res) : 'Error',
      content: content.error ? await content.error(req, res) : undefined,
      error: 'Unknown error occured'
    })
  })

  app.get('/auth/logout', function (req, res) {
    req.session.destroy()
    req.logout()
    res.redirect('/')
  })

  passport.serializeUser(function (user, cb) {
    cb(null, user)
  })

  passport.deserializeUser(function (obj, cb) {
    cb(null, obj)
  })

  if (STRATEGY === 'local') {
    passport.use(
      new LocalStrategy(function (username, password, done) {
        logger.verbose('Login username', username, 'password', password)
        const email = 'test@email.com'
        if (username === 'test' && password === '123') {
          const profile = {
            id: username,
            email,
            email_verified: true,
            displayName: 'Tester',
            emails: [
              {
                value: email,
                email_verified: true
              }
            ]
          }
          const accessToken = 'deadbeef'
          const refreshToken = 'beefdead'
          profile.credentials = {
            accessToken,
            refreshToken
          }
          profile.email = email
          User.upsert({ email }, profile).then(user => {
            signToken({
              id: profile.id,
              sub: profile.email,
              accessToken,
              refreshToken,
              userId: user._id
            }).then(token => {
              profile.token = token
              profile.userId = user._id
              done(null, profile)
            })
          })
        } else {
          return done(null, false)
        }
      })
    )

    app.get('/auth/login', (req, res) =>
      res.render('local-login', {
        baseUrl,
        session: req.session,
        user:
          req.session.passport && req.session.passport.user && req.session.passport.user.token
            ? req.session.passport.user
            : undefined,
        options
      })
    )

    app.post(
      '/auth/submit',
      passport.authenticate('local', { failureRedirect: baseUrl + '/error' }),
      function (req, res) {
        res.redirect('/dashboard')
      }
    )
  }

  if (STRATEGY === 'google') {
    passport.use(
      new GoogleStrategy(
        {
          ...config,
          passReqToCallback: true
        },
        function (req, accessToken, refreshToken, profile, done) {
          const email = profile.email ? profile.email : profile.emails[0].value
          logger.info('Logged in to Google', profile.id, email)
          profile.credentials = {
            accessToken,
            refreshToken
          }
          profile.email = email
          User.upsert({ email }, profile).then(user => {
            signToken({
              id: profile.id,
              sub: email,
              accessToken,
              refreshToken,
              userId: user._id
            }).then(token => {
              profile.token = token
              profile.userId = user._id
              done(null, profile)
            })
          })
        }
      )
    )

    app.get(
      '/auth/login',
      passport.authenticate('google', {
        // https://developers.google.com/identity/protocols/oauth2/web-server
        scope: process.env.GOOGLE_SCOPES ? process.env.GOOGLE_SCOPES.split(' ') : ['profile', 'email'],
        prompt: 'consent',
        accessType: 'offline',
        includeGrantedScopes: false
      })
    )

    app.get(
      '/auth/google/callback',
      passport.authenticate('google', {
        failureRedirect: baseUrl + '/error'
      }),
      function (req, res) {
        // Successful authentication, redirect success
        res.redirect('/dashboard')
      }
    )
  }

  // Disable caching
  app.use(nocache())

  // Log requests and responses
  if (logger.isVerbose) {
    app.use((request, response, next) => {
      const { method, url } = request
      const __started = new Date().getTime()
      logger.verbose(`--> ${method} ${url}`)
      next()
      const { statusCode } = response
      const now = new Date().getTime()
      const elapsed = now - __started
      logger.verbose(`<-- ${statusCode} ${method} ${url} Δ ${elapsed}ms`)
    })
  }

  app.use(function (err, req, res, _next) {
    const { statusCode, code, message } = err
    const httpCode = parseInt(statusCode || code || 500, 10)
    logger.warn('Error', err)
    if (req.headers.accept && req.headers.accept.indexOf('text/html') >= 0) {
      res
        .status(!isNaN(httpCode) && httpCode > 399 && httpCode < 599 ? httpCode : 500)
        .send(
          (message || 'Internal server error') +
            (global.livereload
              ? '<script async defer src="http://localhost:35729/livereload.js"></script>'
              : '')
        )
    } else {
      res
        .status(!isNaN(httpCode) && httpCode > 399 && httpCode < 599 ? httpCode : 500)
        .send({ message: message || 'Internal server error' })
    }
  })

  app.get('*', function (req, res) {
    if (req.headers.accept && req.headers.accept.indexOf('text/html') >= 0) {
      res
        .status(404)
        .send(
          'Not found' +
            (global.livereload
              ? '<script async defer src="http://localhost:35729/livereload.js"></script>'
              : '')
        )
    } else {
      res.status(404).send({ message: 'Not found' })
    }
  })

  process.on('beforeExit', code => {
    logger.verbose('NodeJS exiting', code)
  })

  process.on('SIGINT', signal => {
    logger.verbose('Caught interrupt signal', signal)
    process.exit(1)
  })

  // Do something when AWS lambda started
  if (process.env.AWS_EXECUTION_ENV !== undefined) {
    // _HANDLER contains specific invocation handler for this NodeJS instance
    logger.verbose('AWS Lambda started, handler:', process.env._HANDLER)
  } else {
    app.listen(port, () => logger.info(`API Server listening on port ${port}`))
  }

  return app
}

const serverlessHandler = app =>
  serverless(app, {
    binary: ['image/png', 'image/jpeg', 'image/x-icon']
  })

module.exports.serverless = app => async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  const result = serverlessHandler(app)(event, context)
  return result
}

module.exports.launch = launch
