const crypto = require("crypto")
const rp = require("request-promise-native")
const octokit = require("@octokit/rest")
const gh = octokit()

const github_auth_token = process.env.auth_token;
const github_webhook_secret = process.env.webhook_secret;

gh.authenticate({
    type: "token",
    token: github_auth_token
})

function verifyWebhook(signature, payload, secret) {
    const hash = crypto.createHmac("sha1", secret)
                       .update(payload)
                       .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), 
                                  Buffer.from(`sha1=${hash}`));
}

function getHeader(header)
{
    return process.env[`Http_${header.replace('-', '_')}`]
}

module.exports = async (context, callback) => {
    try {
        
        const signature_header = getHeader("X-Hub-Signature");
        if(!verifyWebhook(signature_header, context, github_webhook_secret))
            throw new Error("Invalid signature");
        
        const event_header = getHeader("X-Github-Event");
        if (event_header != "issues")
            return callback("Unsupported event: " + event_header);

        /** @type {GitHubApiIssuesEvent} */
        const event = JSON.parse(context);
        const issue = event.issue;

        const sentiment_response = await rp.post("http://gateway:8080/function/sentimentanalysis", {
            body: `${issue.title}. ${issue.body}`
        })
        /** @type {SentimentAnalysisApiReponse} */
        const sentiment = JSON.parse(sentiment_response);

        let polarity_label = 
            sentiment.polarity > 0 
                ? "positive" 
                : sentiment.polarity < 0 
                    ? "negative" 
                    : "neutral";
                    
        const result = await gh.issues.replaceAllLabels({
            owner: event.repository.owner.login,
            repo: event.repository.name,
            number: issue.number,
            labels: [polarity_label]
        });

        callback(undefined, result);
    } catch (e) {
        callback(e)
    }
}