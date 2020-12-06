const logger = require('./logger')
const mongoose = require('mongoose')
const nanoid = require('nanoid')

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
      log.verbose('Returning existing model', model)
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

/**
 * Initializes data access APIs and models.
 *
 * @returns {Promise<DAO>} DAO with models ready to use
 */
module.exports = {
  create: function create(options) {
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
}
