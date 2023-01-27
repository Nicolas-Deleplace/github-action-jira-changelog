const   https = require('https'),
        zlib = require('zlib'),
        fs = require('fs'),
        env = process.env;

const Entities = require('html-entities');
const ejs = require('ejs');
const _ = require('lodash');
const RegExpFromString = require('regexp-from-string');
const core = require('@actions/core');

const { SourceControl, Jira, Config } = require('jira-changelog');


function fail(message, exitCode=1) {
    console.log(`::error::${message}`);
    process.exit(1);
}

const template =
`<% if (jira.releaseVersions && jira.releaseVersions.length) {  %>
Release version: <%= jira.releaseVersions[0].name -%>
<% jira.releaseVersions.forEach((release) => { %>
  * <%= release.projectKey %>: <%= jira.baseUrl + '/projects/' + release.projectKey + '/versions/' + release.id -%>
<% }); -%>
<% } %>
<% blockTickets = tickets.all.filter((t) => !t.reverted); -%>
<% if (blockTickets.length > 0 || !options.hideEmptyBlocks) { -%>
Jira Tickets
---------------------
<% blockTickets.forEach(ticket => { -%>
  * <<%= ticket.fields.issuetype.name %>> - <%- ticket.fields.summary %>
    [<%= ticket.key %>] <%= jira.baseUrl + '/browse/' + ticket.key %>
<% }); -%>
<% if (!blockTickets.length) {%> ~ None ~ <% } %>
<% } -%>
<% blockNoTickets = commits.noTickets; -%>
<% if (blockNoTickets.length > 0 || !options.hideEmptyBlocks) { -%>
Other Commits
---------------------
<% blockNoTickets.forEach(commit => { -%>
  * <%= commit.slackUser ? '@'+commit.slackUser.name : commit.authorName %> - <<%= commit.revision.substr(0, 7) %>> - <%= commit.summary %>
<% }); -%>
<% if (!blockNoTickets.length) {%> ~ None ~ <% } %>
<% } -%>
<% blockPendingByOwner = tickets.pendingByOwner; -%>
<% if (blockPendingByOwner.length > 0 || !options.hideEmptyBlocks) { -%>
Pending Approval
---------------------
<% blockPendingByOwner.forEach(owner => { -%>
<%= (owner.slackUser) ? '@'+owner.slackUser.name : owner.email %>
<% owner.tickets.forEach((ticket) => { -%>
  * <%= jira.baseUrl + '/browse/' + ticket.key %>
<% }); -%>
<% }); -%>
<% if (!blockPendingByOwner.length) {%> ~ None. Yay! ~ <% } -%>
<% } -%>
<% if (tickets.reverted.length) { %>
Reverted
---------------------
<% tickets.reverted.forEach((ticket) => { -%>
  * <<%= ticket.fields.issuetype.name %>> - <%- ticket.fields.summary %>
    [<%= ticket.key %>] <%= jira.baseUrl + '/browse/' + ticket.key %>
    commit: <%= ticket.reverted %>
<% }); -%>
<% } -%>
`;


function transformCommitLogs(config, logs) {
    const ticketHash = logs.reduce((all, log) => {
      log.tickets.forEach((ticket) => {
        all[ticket.key] = all[ticket.key] || ticket;
        all[ticket.key].commits = all[ticket.key].commits || [];
        all[ticket.key].commits.push(log);
      });
      return all;
    }, {});

    const ticketList = _.sortBy(Object.values(ticketHash), ticket => ticket.fields.issuetype.name);
    let pendingTickets = ticketList;
  
    const reporters = {};
    pendingTickets.forEach((ticket) => {
      const email = ticket.fields.reporter.emailAddress;
      if (!reporters[email]) {
        reporters[email] = {
          email,
          name: ticket.fields.reporter.displayName,
          slackUser: ticket.slackUser,
          tickets: [ticket]
        };
      } else {
        reporters[email].tickets.push(ticket);
      }
    });
    const pendingByOwner = _.sortBy(Object.values(reporters), item => item.user);
  
    return {
      commits: {
        all: logs,
        tickets: logs.filter(commit => commit.tickets.length),
        noTickets: logs.filter(commit => !commit.tickets.length)
      },
      tickets: {
        pendingByOwner,
        all: ticketList,
        approved: ticketList.filter(ticket => approvalStatus.includes(ticket.fields.status.name)),
        pending: pendingTickets
      }
    }
  }


  const config = {
    jira: {
      api: {
        host: env.jira_host,
        email: env.jira_mail,
        token: env.jira_token,
      }
    }
  };

async function main() {
    const gitRepoPath="./";
    console.log(env.from);
    console.log(env.to);

    const source = new SourceControl(config);
    const range = {
        from: env.from,
        to: env.to
    }

    const commitLogs = await source.getCommitLogs(gitRepoPath, range);
    const jira = new Jira(config);
    const changelog = await jira.generate(commitLogs);
    const formatedChangelog = await transformCommitLogs(config, changelog);
    const changelogTemplate = ejs.render(template, formatedChangelog);
    const entitles = new Entities.AllHtmlEntities();


    console.log(entitles.decode(changelogTemplate));
    core.setOutput('changelog', changelogTemplate);
}

main();



