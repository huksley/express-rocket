const logger = require('./logger')
const mongoose = require('mongoose')
const nanoid = require('nanoid')
const dao = require('./dao')
const R = require('ramda')

/**
 * @class UserSchema
 */
const UserSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => nanoid.nanoid(16)
  },
  email: { type: String, index: true, unique: true },
  token: String,
  displayName: String,
  credentials: mongoose.Schema.Types.Mixed,
  updatedAt: Date
})

const UserSchemaProperties = ['email', 'token', 'displayName', 'credentials']

const User = {
  find: email =>
    new Promise(resolve => {
      dao.create(options).then(dao => {
        const User = dao.connection.model('User', UserSchema)
        User.find({ email })
          .exec()
          .then(users => {
            if (users.length == 0) {
              resolve(undefined)
            } else if (users.length > 1) {
              logger.warn('Consistency error, found users: ', users.length)
              resolve(R.head(users).toObject())
            } else {
              resolve(R.head(users).toObject())
            }
          })
      })
    }),
  upsert: user => {
    user = R.pick(UserSchemaProperties, user)
    return new Promise(resolve =>
      dao.create().then(dao => {
        const User = dao.model('user', UserSchema)
        User.find({ email: user.email })
          .exec()
          .then(users => {
            if (users.length == 0) {
              logger.verbose('Creating user', user)
              new User({
                ...user,
                updatedAt: new Date()
              })
                .save()
                .then(resolve)
            } else {
              if (users.length > 1) {
                logger.warn('Consistency error, found users: ', users.length)
              }
              const existing = R.head(users)
              if (!R.equals(user, R.pick(UserSchemaProperties, existing))) {
                user.credentials = Object.assign(existing.credentials || {}, user.credentials || {})
                existing.attributes = user.attributes
                existing.markModified('attributes')

                logger.verbose('Updating user', user, R.pick(UserSchemaProperties, existing.toObject()))
                existing
                  .set({
                    ...user,
                    updatedAt: new Date()
                  })
                  .save()
                  .then(resolve)
              } else {
                logger.verbose('User not changed', user.email)
              }
            }
          })
      })
    )
  }
}

module.exports = {
  User
}
