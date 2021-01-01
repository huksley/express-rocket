const logger = require('./logger')
const mongoose = require('mongoose')
const nanoid = require('nanoid')
const R = require('ramda')

let dao = null

class DAO {
  /**
   * Create DAO instance.
   *
   * @param {mongoose.Connection} conn - Connection to MongoDB
   */
  constructor(conn, options) {
    /**
     * Private connection property
     *
     * @type {mongoose.Connection}
     * @public
     */
    this.connection = conn
    this.options = options
  }

  model(name, schema) {
    const model = (this.options && this.options.modelPrefix ? this.options.modelPrefix : '') + name
    const existing = this.connection.models[model]
    if (existing) {
      logger.verbose('Returning existing model', model)
      return existing
    } else {
      return this.connection.model(model, schema)
    }
  }

  close() {
    logger.verbose('Closing MongoDB connection')
    this.connection.close()
    this.connection = null
    dao = null
  }

  generateId() {
    return nanoid.nanoid(16)
  }
}

const create = function (options) {
  return new Promise(async resolve => {
    const url = process.env.MONGO_URL
    const mongoUrl = url
      .replace('$MONGO_PASSWORD', process.env.MONGO_PASSWORD)
      .replace('$MONGO_USER', process.env.MONGO_USER)

    if (dao === null) {
      logger.verbose('Connecting to ' + url)
      const conn = await mongoose.createConnection(mongoUrl, {
        bufferCommands: false,
        bufferMaxEntries: 0,
        useNewUrlParser: true,
        useUnifiedTopology: true,
        useCreateIndex: true,
        useFindAndModify: false
      })

      dao = new DAO(conn, options)
      logger.verbose('Created dao', Object.keys(dao))
    }

    resolve(dao)
  })
}

/**
 * Initializes data access APIs and models.
 *
 * @returns {Promise<DAO>} DAO with models ready to use
 */
module.exports = {
  create,
  define: function (name, model, properties, options) {
    options = options || {}
    const schema = new mongoose.Schema({
      _id: {
        type: String,
        default: () => nanoid.nanoid(16)
      },
      updatedAt: Date,
      ...model
    })

    return {
      schema,
      name,
      properties,
      json: obj => (obj === undefined ? obj : JSON.parse(JSON.stringify(obj))),
      // Single record
      find: filter =>
        new Promise((resolve, reject) => {
          create()
            .then(dao => {
              const Model = dao.connection.model(name, schema)
              Model.find(filter)
                .exec()
                .then(records => {
                  if (records.length == 0) {
                    resolve(undefined)
                  } else if (records.length > 1) {
                    logger.warn('Consistency error, found ' + name + ' records: ', records.length)
                    resolve(R.head(records))
                  } else {
                    resolve(R.head(records))
                  }
                })
                .catch(reject)
            })
            .catch(reject)
        }),
      delete: id => {
        return new Promise((resolve, reject) =>
          create()
            .then(dao => {
              const Campaign = dao.model(name, schema)
              Campaign.find({ _id: id })
                .exec()
                .then(records => {
                  const existing = R.head(records)
                  if (!existing) {
                    logger.warn('Specified id cannot be found: ', id)
                    resolve(undefined)
                  } else {
                    logger.verbose('Deleting', id)
                    existing.deleteOne()
                    resolve(existing)
                  }
                })
                .catch(reject)
            })
            .catch(reject)
        )
      },
      // Filter all records
      filter: filter =>
        new Promise((resolve, reject) => {
          create(options)
            .then(dao => {
              const Model = dao.connection.model(name, schema)
              Model.find({ ...filter })
                .exec()
                .then(records => {
                  resolve(records)
                })
                .catch(reject)
            })
            .catch(reject)
        }),
      create: obj => {
        return new Promise((resolve, reject) =>
          create()
            .then(dao => {
              const Model = dao.model(name, schema)
              logger.verbose('Creating', obj)
              new Model({
                ...obj,
                updatedAt: new Date()
              })
                .save()
                .then(resolve)
                .catch(reject)
            })
            .catch(reject)
        )
      },
      // Add or update one based on filter
      upsert: (filter, obj) => {
        const filtered = R.pick(properties, obj)
        return new Promise((resolve, reject) =>
          create()
            .then(dao => {
              const Model = dao.model(name, schema)
              Model.find({ ...filter })
                .exec()
                .then(records => {
                  if (records.length == 0) {
                    logger.verbose('Creating', obj)
                    new Model({
                      ...obj,
                      updatedAt: new Date()
                    })
                      .save()
                      .then(resolve)
                      .catch(reject)
                  } else {
                    if (records.length > 1) {
                      logger.warn('Consistency error, found records: ', records.length)
                    }
                    const existing = R.head(records)
                    const existingFiltered = R.pick(properties, existing)
                    if (!R.equals(filtered, existingFiltered)) {
                      logger.verbose('Updating record')
                      options.preUpdate && options.preUpdate(existing, obj)
                      existing
                        .set({
                          ...obj,
                          updatedAt: new Date()
                        })
                        .save()
                        .then(resolve)
                        .catch(reject)
                    } else {
                      logger.verbose('Record not changed')
                      resolve(existing)
                    }
                  }
                })
                .catch(reject)
            })
            .catch(reject)
        )
      }
    }
  }
}
