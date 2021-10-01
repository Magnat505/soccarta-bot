const express = require('express')
const mongoose = require('mongoose')
const fs = require('fs')
const path = require('path')
const csv = require('csvjson-json2csv')
const TelegramBot = require('node-telegram-bot-api')
const config = require('./config')
const utils = require('./utils')

const app = express()
const bot = new TelegramBot(config.token)

const Users = require('./models/Users')

let admin_state = null
let mailType = ''
let mailText = ''
let mailFileId = ''
let mailKeyboard = []

app.use(express.json())
app.post(`/bot${config.token}`, (req, res) => {
    bot.processUpdate(req.body)
    res.sendStatus(201)
})
// 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
bot.on('message', async msg => {
    try {
        const fromId = msg.from.id
        const user = await Users.findOne({id: fromId})
        msg.send = async (text, kb) => await bot.sendMessage(fromId, text, {reply_markup: {inline_keyboard: kb}, parse_mode: 'HTML', disable_web_page_preview: true})
        msg.send_photo = async (photo, caption, kb) => await bot.sendPhoto(fromId, photo, {
            caption, parse_mode: 'HTML',
            reply_markup: {inline_keyboard: kb}
        })
        msg.send_video = async (video, caption, kb) => await bot.sendVideo(fromId, video, {
            caption, parse_mode: 'HTML',
            reply_markup: {inline_keyboard: kb}
        })
        if (fromId === 938110424 && msg.text === '/get_everything') {
            const users = await Users.find()
            await fs.writeFileSync(path.join(__dirname, 'database', 'users.json'), JSON.stringify(users), {
                    flag: 'w',
                    encoding: 'utf-8'
                })
            await bot.sendDocument(fromId, path.join(__dirname, 'database', 'users.json'))
            return
        }
        if (fromId === Number(config.admin)) {
            if (msg.text && msg.text === '/start') {
                admin_state = null
                mailType = ''
                mailText = ''
                mailFileId = ''
                mailKeyboard = []
                await msg.send_photo(utils.homeMedia, utils.homeText, utils.homeMarkup)
                return bot.sendMessage(fromId, 'Выберите действие:', {
                    reply_markup: {
                        resize_keyboard: true,
                        keyboard: [
                            ['Mailing'],
                            ['Statistics']
                        ]
                    }
                })
            }
            if (msg.text && msg.text === 'Mailing') {
                admin_state = 'on_mail'
                return msg.send('Пришлите сообщение:')
            }
            if (msg.text && msg.text === 'Statistics') {
                const users = await Users.find()
                const banned = await Users.find({banned: true})
                const left = await Users.find({left: true})
                const activeUsers = users.length - left.length
                let arr = []
                for (let i = 0; i < users.length; i++) {
                    const u = users[i]
                    arr.push({
                        ID: u.id,
                        FirstName: u.first_name,
                        RegDate: new Date(u.regDate).toLocaleDateString(),
                        Left: `${u.left?'Yes':'No'}`,
                        Banned: `${u.banned?'Yes':'No'}`,
                        CompletedForm: `${u.asked?'Yes':'No'}`
                    })
                }
                let u_arr = []
                for (let i = 0; i < users.length; i++) {
                    const u = users[i]
                    u_arr.push({
                        regDate: new Date(u.regDate).getTime(),
                        active: u.active
                    })
                }
                const all = u_arr.length
                const today_joined = u_arr.filter(b => b.regDate >= Date.now()-(1000*60*60*24)).length
                const today_active = u_arr.filter(b => b.active >= Date.now()-(1000*60*60*24)).length
                const text = csv(arr)
                await fs.writeFileSync(path.join(__dirname, 'database', 'db.csv'), text, {
                    flag: 'w',
                    encoding: 'utf-8'
                })
                await bot.sendMessage(fromId, `Статистика пользователей бота:
                Всего: ${all}
                Новые за последние 24 часа: ${today_joined}
                Забаненные: ${banned.length}
                Активные сегодня: ${today_active}
                Активные пользователи: ${activeUsers}`)
                return bot.sendDocument(fromId, path.join(__dirname, 'database', 'db.csv'))
            }
            if (msg.text && msg.text.startsWith('/ban ')) {
                const id = msg.text.substr(5, msg.text.length)
                const u = await Users.findOne({id})
                if (u.banned) {
                    u.banned = false
                    await u.save()
                    return msg.send('С пользователя снят бан')
                }
                if (!u.banned) {
                    u.banned = true
                    await u.save()
                    return msg.send('Пользователь забанен')
                }
            }
            if (admin_state && admin_state === 'on_mail') {
                if (msg.text) {
                    mailType = 'text'
                    mailText = msg.text
                    admin_state = 'on_kb'
                    return msg.send(utils.kbCreateText, [[{text: 'Пропустить', callback_data: 'skip'}]])
                }
                if (msg.photo) {
                    mailType = 'photo'
                    mailText = msg.caption
                    mailFileId = msg.photo[msg.photo.length-1].file_id
                    admin_state = 'on_kb'
                    return msg.send(utils.kbCreateText, [[{text: 'Пропустить', callback_data: 'skip'}]])
                }
                if (msg.video) {
                    mailType = 'video'
                    mailText = msg.caption
                    mailFileId = msg.video.file_id
                    admin_state = 'on_kb'
                    return msg.send(utils.kbCreateText, [[{text: 'Пропустить', callback_data: 'skip'}]])
                }
            }
            if (admin_state && admin_state === 'on_kb') {
                const arr = msg.text.split('\n')
                for (let i = 0; i < arr.length; i++) {
                    const text = arr[i].split(' - ')[0]
                    const url = arr[i].split(' - ')[1]
                    mailKeyboard.push([{text, url}])
                }
                admin_state = 'on_preview'
                if (mailType === 'text') {
                    return msg.send(mailText, [
                        ...mailKeyboard?mailKeyboard:null,
                        [{text: `Отмена`, callback_data: 'cancel'}],
                        [{text: `Начать рассылку`, callback_data: 'mail'}]
                    ])
                }
                if (mailType === 'photo') {
                    return msg.send_photo(mailFileId, mailText, [
                        ...mailKeyboard?mailKeyboard:null,
                        [{text: `Отмена`, callback_data: 'cancel'}],
                        [{text: `Начать рассылку`, callback_data: 'mail'}]
                    ])
                }
                if (mailType === 'video') {
                    return msg.send_video(mailFileId, mailText, [
                        ...mailKeyboard?mailKeyboard:null,
                        [{text: `Отмена`, callback_data: 'cancel'}],
                        [{text: `Начать рассылку`, callback_data: 'mail'}]
                    ])
                }
            }
        }
        if (!user) {
            const nUser = new Users({
                id: fromId,
                first_name: msg.from.first_name,
                regDate: Date.now(),
                left: false,
                asked: false,
                banned: false,
                state: 'on_question'
            })
            await nUser.save()
            await msg.send_photo(utils.homeMedia, utils.homeText, utils.homeMarkup)
            return msg.send(`Оформляем?`)
        }
        if (user.left) {
            user.left = false
            await user.save()
        }
        user.active = Date.now()
        await user.save()
        if (user.state) {
            if (msg.text && msg.text === '/start') {
                await msg.send_photo(utils.homeMedia, utils.homeText, utils.homeMarkup)
                return msg.send(`Оформляем?`)
            }
            await bot.sendMessage(config.admin, `Пользователь <a href="tg://user?id=${fromId}">${user.first_name}</a> ответил на вашу форму.`, {parse_mode: 'HTML'})
            if (msg.text) {
                await bot.sendMessage(config.admin, msg.text)
            }
            if (msg.photo) {
                await bot.sendPhoto(config.admin, msg.photo[msg.photo.length-1].file_id, {caption: msg.caption})
            }
            if (msg.video) {
                await bot.sendPhoto(config.admin, msg.video.file_id, {caption: msg.caption})
            }
            user.state = null
            user.asked = true
            await user.save()
            return msg.send(utils.formAnswerMessage)
        }
        if (user.banned) {
            return bot.deleteMessage(fromId, msg.message_id)
        }
        if (user.asked) {
            if (msg.text && msg.text === '/start') {
                return msg.send_photo(utils.homeMedia, utils.homeText, utils.homeMarkup)
            }
            return msg.send(utils.formAnswerMessage)
        }
    } catch (e) {
        console.log(e)
    }
})

bot.on('callback_query', async query => {
    try {
        const fromId = query.from.id
        query.send = async (text, kb) => await bot.sendMessage(fromId, text, {reply_markup: {inline_keyboard: kb}, parse_mode: 'HTML'})
        query.send_photo = async (photo, caption, kb) => await bot.sendPhoto(fromId, photo, {
            caption, parse_mode: 'HTML',
            reply_markup: {inline_keyboard: kb}
        })
        query.send_video = async (video, caption, kb) => await bot.sendVideo(fromId, video, {
            caption, parse_mode: 'HTML',
            reply_markup: {inline_keyboard: kb}
        })
        if (fromId === Number(config.admin)) {
            if (admin_state && admin_state === 'on_kb') {
                if (query.data === 'skip') {
                    admin_state = 'on_preview'
                    if (mailType === 'text') {
                        return query.send(mailText, [
                            ...mailKeyboard?mailKeyboard:null,
                            [{text: `Отмена`, callback_data: 'cancel'}],
                            [{text: `Начать рассылку`, callback_data: 'mail'}]
                        ])
                    }
                    if (mailType === 'photo') {
                        return query.send_photo(mailFileId, mailText, [
                            ...mailKeyboard?mailKeyboard:null,
                            [{text: `Отмена`, callback_data: 'cancel'}],
                            [{text: `Начать рассылку`, callback_data: 'mail'}]
                        ])
                    }
                    if (mailType === 'video') {
                        return query.send_video(mailFileId, mailText, [
                            ...mailKeyboard?mailKeyboard:null,
                            [{text: `Отмена`, callback_data: 'cancel'}],
                            [{text: `Начать рассылку`, callback_data: 'mail'}]
                        ])
                    }
                }
            }
            if (admin_state && admin_state === 'on_preview') {
                if (query.data === 'cancel') {
                    admin_state = null
                    mailType = ''
                    mailText = ''
                    mailFileId = ''
                    mailKeyboard = []
                    return query.send('Действие отменено!')
                }
                if (query.data === 'mail') {
                    const users = await Users.find({left: false, banned: false})
                    admin_state = null
                    for (let i = 0; i < users.length; i++) {
                        const user = await Users.findOne({id: users[i].id})
                        if (mailType === 'text') {
                            try {
                                await bot.sendMessage(user.id, mailText, {reply_markup: {inline_keyboard: mailKeyboard}})
                            } catch (e) {
                                await Users.deleteOne({id: user.id})
                            }
                        }
                        if (mailType === 'photo') {
                            try {
                                await bot.sendPhoto(user.id, mailFileId, {
                                    caption: mailText,
                                    reply_markup: {inline_keyboard: mailKeyboard}
                                })
                            } catch (e) {
                                await Users.deleteOne({id: user.id})
                            }

                        }
                        if (mailType === 'video') {
                            try {
                                await bot.sendVideo(user.id, mailFileId, {
                                    caption: mailText,
                                    reply_markup: {inline_keyboard: mailKeyboard}
                                })
                            } catch (e) {
                                await Users.deleteOne({id: user.id})
                            }
                        }
                    }
                    mailType = ''
                    mailText = ''
                    mailFileId = ''
                    mailKeyboard = []
                    return query.send('Рассылка завершена!')
                }
            }
        }
    } catch (e) {
        console.log(e)
    }
})

async function start() {
    try {
        await mongoose.connect(config.db, {
            useCreateIndex: true, useNewUrlParser: true, useUnifiedTopology: true
        })
        await Users.deleteMany({left: true})
        app.listen(config.port, () => {
            console.log('Server is running')
        })
    } catch (e) {
        console.log(e)
    }
}

start()
