
const axios = require('axios')
const chalk = require('chalk')
const csv = require('csvtojson')
const fs = require('fs')
const path = require('path')
const config = require('./config.js')
const inquirer = require('inquirer')
const csvOutput = "scan-output"
const moment = require('moment')
const { ConcurrencyManager } = require('axios-concurrency')

const MAX_CONCURRENT_REQUESTS = 3
const manager = ConcurrencyManager(axios, MAX_CONCURRENT_REQUESTS)
const baseUrl = ".instructure.com/api/v1/courses/sis_course_id:"
const ext = ".csv"

const fileList = fs.readdirSync("./", (err,files) => { return files})

const filteredList = fileList.filter(file => {
  return path.extname(file).toLowerCase() === ext
})

function listMigrations (answers, baseUrl, course) {
  course.sis_id = encodeURIComponent(course.sis_id)
  return axios
        .get(`https://${answers.domain}${baseUrl}${course.sis_id}/content_migrations`, {
          headers: {
            "Authorization": `Bearer ${config.token}`
          }
        })
        .then(res => {
          console.log(chalk.red(`scanned ${course.sis_id}`))
          return res.data} )
        .catch(e => console.error(e))
}

async function issueCheck (response, courseData) {
  courseData.imports = response.map(async (response) => {
    description = await getDesc(response)
    .then(result => {
      console.log(chalk.yellow(`checking ${response.id}`))
      return result
    })
    return {
      id: response.id,
      status: response.workflow_state,
      issues: description
    }
  })
  return Promise.all(courseData.imports).then(result => {return result})
}

async function getDesc (response) {
    return await (function (response) {
      return axios.get(response.migration_issues_url, {
        headers: {
          "Authorization": `Bearer ${config.token}`
        }
      })
    })(response)
    .then(res => {
      if (response.workflow_state === 'failed') {
        return {
          description: res.data[0].description,
          error_url: res.data[0].error_report_html_url
        }
      } else {
        return "no issues"
      }
    })
}

inquirer
  .prompt([
    {
      type: "input",
      name: "domain",
      message: "What is the domain? "
    },
    {
      type: "list",
      name: "filePath",
      message:  "Please select your csv",
      choices: filteredList
    }
  ])
  .then(async answers => {
    const courses = await csv().fromFile(`./${answers.filePath}`)
    // .map() will be used here to manipulate the original array data without mutating it.
    const courseData = courses.map(async (course, index) => {
      try {
        let courseData = []
        courseData.course = course.sis_id
        const initRes = await listMigrations(answers, baseUrl, course)
        const issueParse = await issueCheck(initRes, courseData)
        return courseData
      } catch (e) {
        console.error(e)
      }
    })

    let current = moment().format('MMDDYY-HHMM')
    let filename = answers.domain + "-" +  csvOutput + "-" + current

    Promise.all(courseData).then(async data => {
      for (i = 0; i < data.length; i++){
        let importedData = await (async function (data) {
        return await Promise.all(data[i].imports)
        })(data)
        .then(result => {
          return result
        })
        fs.appendFile(filename +  ".csv", `${data[i].course}, "${JSON.stringify(importedData)}"\n`, function(err) {});
        console.log(chalk.green(`Logged ${data[i].course}`))
      }
    })
  })