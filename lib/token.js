const jwt = require('jsonwebtoken')
const logger = require('./logger')

// Get auth header value, and if successful, attach token data to request
const checkTokenMiddleware = (req, _res, next) => {
  const bearerHeader = req.headers['authorization']
  if (typeof bearerHeader !== 'undefined') {
    const token = bearerHeader.split(' ')[1]
    verifyToken(token)
      .then(data => {
        logger.verbose('Authenticated with token', data)
        req.auth = data
        next()
      })
      .catch(error => {
        logger.warn('Authentication with token failed', error)
        next(error)
      })
  } else {
    next('Not authenticated')
  }
}

// Verify token validity
const verifyToken = token => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, process.env.SESSION_SECRET, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

// Issue Token
const signToken = data => {
  return new Promise((resolve, reject) => {
    jwt.sign(data, process.env.SESSION_SECRET, { expiresIn: '365 day' }, (err, token) => {
      if (err) {
        reject(err)
      } else {
        logger.verbose('Created token', token)
        return resolve(token)
      }
    })
  })
}

module.exports.middleware = checkTokenMiddleware
module.exports.signToken = signToken
module.exports.verifyToken = verifyToken
