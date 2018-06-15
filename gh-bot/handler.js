const fs = require("fs")
const util = require("util")
const crypto = require("crypto")
const rp = require("request-promise-native")
const octokit = require("@octokit/rest")
const gh = octokit()

async function getSecret(name)
{
    const readFile = util.promisify(fs.readFile)
    return (await readFile(`/run/secrets/${name}`)).toString()
}

function getHeader(header)
{
    return process.env[`Http_${header.replace(/-/g, '_')}`]
}

function verifyWebhook(signature, payload, secret) {
    const hash = crypto.createHmac("sha1", secret)
                       .update(payload)
                       .digest("hex")
    return crypto.timingSafeEqual(Buffer.from(signature), 
                                  Buffer.from(`sha1=${hash}`))
}

async function handler(request) {
    if (!verifyWebhook(
        getHeader("X-Hub-Signature"),
        request,
        await getSecret("webhook-secret")))
        throw new Error("Invalid signature")

    const event_header = getHeader("X-Github-Event")
    if (event_header != "issues")
        throw new Error(`Unrecognized or unsupported event header: ${event_header}`)

    /** @type {GitHubApiIssuesEvent} */
    const event = JSON.parse(request)
    const issue = event.issue

    const sentiment_response = await rp.post("http://gateway:8080/function/sentimentanalysis", {
        body: `${issue.title}. ${issue.body}`
    })
    /** @type {SentimentAnalysisApiReponse} */
    const sentiment = JSON.parse(sentiment_response)

    let polarity_label = 
        sentiment.polarity > 0 
            ? "positive" 
            : sentiment.polarity < 0 
                ? "negative" 
                : "neutral"

    gh.authenticate({
        type: "token",
        token: await getSecret("auth-token")
    })
    const result = await gh.issues.replaceAllLabels({
        owner: event.repository.owner.login,
        repo: event.repository.name,
        number: issue.number,
        labels: [polarity_label]
    })
    return result
}

module.exports = async (request, callback) => {
    let result
    try
    {
        result = await handler(request)
    }
    catch(err)
    {
        return callback(err)
    }
    if(result)
        return callback(undefined, result)
}