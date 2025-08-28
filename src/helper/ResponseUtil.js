const Ok = (res, msg, data) => {
    createMsg(res, 200, msg, data)
}

const BadRequest = (res, msg, data) => {
    createMsg(res, 400, msg, data, "Bad Request")
}

const InternalServerErr = (res, msg) => {
    createMsg(res, 500, msg, undefined, "Internal Server Error")
}

const createMsg = (res, statusCode, message = "", data, error) => {
    res.status(statusCode).send({
        statusCode,
        message,
        data,
        error
    })
}


module.exports = { Ok, BadRequest, InternalServerErr}