const express = require('express');
const cors = require('cors');
const mongo = require('mongodb');
const assert = require('assert');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');

const uri = "HIDDEN";
const app = express();
app.use(express.json());
app.use(cors());
const port = 3001;

var options = {
    auth: {
        api_user: 'HIDDEN',
        api_key: 'HIDDEN'
    }
}

var emailClient = nodemailer.createTransport(sgTransport(options));

//For confirmation email, link in email points to this endpoint and then redirects to sign in
app.get('/the-spot/authenticate/:verify', (req, res) => {
    const verify = req.params.verify;
    mongo.connect(uri, (err, client) => {
        if(err) throw err;
        const userCollection = client.db('the-spot-db').collection('users');
        //if kverify is present, verify user
        if(verify) {
            userCollection.updateOne({hashedEmail: verify}, { $set: { isVerified: true } });
            console.log('User verified');
        }
        res.redirect('http://localhost:3000/the-spot/sign-in');
    })
})

app.post('/register', (req, res) => {
    const { name, email, password } = req.body;
    
    if (!name || !email || !email.includes('@') || !email.includes('.') || !password) {
        return res.status(400).json('Incorrect inputs.');
    }
    
    mongo.connect(uri, (err, client) => {
        if(err) throw err;
        const userCollection = client.db('the-spot-db').collection('users');
        userCollection.find({email: email}).toArray((err, result) => {
            if(err) throw err;
            if(result.length > 0) {
                // USER FOUND, DO NOT CONTINUE WITH REGISTRATION
                res.status(400).json('Email already in use, please register with a different email.');
            } else {
                // USER NOT FOUND, CONTINUE WITH REGISTRATION
                const registerEmailHasher = crypto.createHash('sha256');
                registerEmailHasher.update(email);
                const hashedEmail = registerEmailHasher.copy().digest('hex');
                
                const registerPasswordHasher = crypto.createHash('sha256');
                registerPasswordHasher.update(password);
                const hashedPassword = registerPasswordHasher.copy().digest('hex');
                const newUser = {
                    name: name,
                    email: email,
                    password: hashedPassword,
                    isVerified: false,
                    hashedEmail: hashedEmail,
                    spots: [],
                    dateJoined: new Date()
                }
                userCollection.insert(newUser, (err, result) => {
                    // New user inserted in db, send confirmation email with hash
                    if(err) throw err;
                    var emailToSend = {
                        from: 'richard.norman.id@gmail.com',
                        to: email,
                        subject: `Welcome ${name}! Please verify your email address.`,
                        text: `Greetings from The Spot team! Please click the link below to verify your email address.\n\nhttp://localhost:3001/the-spot/authenticate/${hashedEmail}\n\nThanks!`
                    };

                    emailClient.sendMail(emailToSend, (err, info) => {
                        if(err) throw err;
                        console.log('Message sent: ' + info.response);
                    })

                    res.json('User registered.');
                })
            }
            client.close();
        });
    })
})

app.post('/sign-in', (req, res) => {
    const { email, password } = req.body;
    const verify = req.query.verify;

    if(!email || !password) {
        return res.status(400).json('Incorrect email/password.')
    }

    mongo.connect(uri, (err, client) => {
        if(err) throw err;
        const userCollection = client.db('the-spot-db').collection('users');

        //before user can login they must verify
        userCollection.findOne({email: email}, (err, result) => {
            if(err) throw err;

            const signInPasswordHasher = crypto.createHash('sha256');
            signInPasswordHasher.update(password);
            const hashedPassword = signInPasswordHasher.copy().digest('hex');
            if(result.isVerified && hashedPassword === result.password) {
                res.status(200).json('User is verified and password is correct, sign in!')
            } else {
                res.status(400).json('User is either not verfified or login credentials invalid.')
            }
            client.close();
        });
    })
})

app.get('/get-spots/:email', (req, res) => {
    //given the email, return the spots associated with that email
    const email = req.params.email;
    mongo.connect(uri, (err, client) => {
        if(err) throw err;

        const userCollection = client.db('the-spot-db').collection('users');
        userCollection.findOne({email: email}, (err, result) => {
            if(err) throw err;
            res.json(result.spots);
        })
        client.close();
    });
})

app.post('/add-spot/:email', (req, res) => {
    const { title, description, image, coords } = req.body;
    const email = req.params.email;

    if(!title || !coords) return res.status(400).json('Invalid spot details.')

    //create the new spot object
    const newSpot = {
        id: mongo.ObjectId(),
        title: title,
        description: description,
        image: image,
        coords: coords,
        dateCreated: new Date()
    }

    mongo.connect(uri, (err, client) => {
        if(err) throw err;

        //add the new spot object to the user's spots array
        const userCollection = client.db('the-spot-db').collection('users');
        userCollection.findOneAndUpdate({email: email}, { $push: { spots: newSpot } });
        client.close();
    })
})

app.put('/update-spot/:email', (req, res) => {
    const { id, title, description, image, coords, dateCreated } = req.body;
    const email = req.params.email;

    if(!title || !coords) return res.status(400).json('Invalid spot details.')

    const updatedSpot = {
        id: mongo.ObjectId(id),
        title: title,
        description: description,
        image: image,
        coords: coords,
        dateCreated: dateCreated
    }

    console.log(updatedSpot)

    mongo.connect(uri, (err, client) => {
        if(err) throw err;

        //add the new spot object to the user's spots array
        const userCollection = client.db('the-spot-db').collection('users');
        userCollection.updateOne({email: email, "spots.id": mongo.ObjectId(id)}, { $set: { "spots.$": updatedSpot } });
        client.close();
    })
})

app.delete('/remove-spot/:email', (req, res) => {
    const { id } = req.body;
    const email = req.params.email;

    if(!id) return res.status(400).json('Spot does not exist')

    mongo.connect(uri, (err, client) => {
        if(err) throw err;
        console.log(`Email: ${email}   Id: ${id}`)
        const userCollection = client.db('the-spot-db').collection('users');
        userCollection.updateOne({email: email}, { $pull: { spots: { id: mongo.ObjectId(id) } } });
        client.close();
    })
})

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
})