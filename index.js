const express = require("express");
const app = express();
const morgan = require("morgan");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const nodemailer = require("nodemailer");
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

// middleware
const corsOptions = {
  origin: "*",
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan("dev"));

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zruwsn2.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Validate jwt
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "Unauthorized Access" });
  }
  const token = authorization.split(" ")[1];
  // token verify
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "Unauthorized Access" });
    }
    req.decoded = decoded;
    next();
  });
};

//send mail function
const sendMail = (emailData, emailAddress) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL,
    to: emailAddress,
    subject: emailData.subject,
    html: `<p>${emailData?.message}</p>`,
  };

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
      // do something useful
    }
  });
};

async function run() {
  try {
    const usersCollection = client.db("CareConnectsDb").collection("users");
    const placesCollection = client.db("CareConnectsDb").collection("places");
    const bookingsCollection = client
      .db("CareConnectsDb")
      .collection("bookings");

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;

      if (price) {
        const amount = parseFloat(price) * 100;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      }
    });

    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "7d",
      });
      res.send({ token });
    });

    // Svae user email & Role to database
    app.put("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // Get all places
    app.get("/places", async (req, res) => {
      const result = await placesCollection.find().toArray();
      res.send(result);
    });

    //Delete doctors place
    app.delete("/places/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await placesCollection.deleteOne(query);
      res.send(result);
    });

    // Get all doctors places for host by email
    app.get("/places/:email", verifyJWT, async (req, res) => {
      const decodedEmail = req.decoded.email;
      const email = req.params.email;
      if (email !== decodedEmail) {
        return res
          .status(403)
          .send({ error: true, message: "Forbidden Access" });
      }
      const query = { "host.email": email };
      const place = await placesCollection.find(query).toArray();
      res.send(place);
    });

    // Get a single doctors place by id
    app.get("/place/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const place = await placesCollection.findOne(query);
      res.send(place);
    });

    // save a doctor place in database
    app.post("/places", async (req, res) => {
      const place = req.body;
      const result = await placesCollection.insertOne(place);
      res.send(result);
    });

    // update a doctor place in database
    app.put("/places/:id", verifyJWT, async (req, res) => {
      const place = req.body;
      console.log(place);
      const filter = { _id: new ObjectId(req.params.id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: place,
      };
      const result = await placesCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    //update place appoinment booking status
    app.patch("/places/status/:id", async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          booked: status,
        },
      };
      const update = await placesCollection.updateOne(query, updateDoc);
      res.send(update);
    });

    // Get bookings for patients
    app.get("/bookings", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }
      const query = { "guest.email": email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    // Get bookings for doctor as host
    app.get("/bookings/host", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }
      const query = { host: email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    //save a appoinment bookings to database
    // app.post("/bookings", async (req, res) => {
    //   const booking = req.body;
    //   const result = await bookingsCollection.insertOne(booking);
    //   // send confirmation email to patitnet  email account
    //   sendMail(
    //     {
    //       subject: "Your Appoinment Booked Successful",
    //       message: `Booking Id: ${result?.insertedId}, TransactionId: ${booking.transactionId}`,
    //     },
    //     booking?.guest?.email
    //   );
    //   // send confirmation email to doctors host email account
    //   sendMail(
    //     {
    //       subject: "Your Appoinment booked Successfully!",
    //       message: `Booking Id: ${result?.insertedId}, TransactionId: ${booking.transactionId}`,
    //     },
    //     booking?.host?.email
    //   );
    //   res.send(result);
    // });

    // ...

    // Delete a booking by ID
    app.delete("/bookings/:id", async (req, res) => {
      const bookingId = req.params.id;

      try {
        const result = await bookingsCollection.deleteOne({
          _id: new ObjectId(bookingId),
        });

        if (result.deletedCount === 1) {
          res.status(200).json({ message: "Booking deleted successfully." });
        } else {
          res.status(404).json({ message: "Booking not found." });
        }
      } catch (error) {
        console.error("Error deleting booking:", error);
        res.status(500).json({ message: "Internal server error." });
      }
    });

    //message sent by node mailer

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);

      // Meeting Link
      const meetingLink =
        "https://calendly.com/rahyanakil89/appoinment-booking";

      // Confirmation Email to Patient
      const patientEmailContent = `
        <h2>Thanks For Choosing Care Connect</h2>
        <h4>Your Online Appointment Booking Details</h4>
        <p>Booking ID: ${result?.insertedId}</p>
        <p>Transaction ID: ${booking.transactionId}</p>
        <p>Thank you for booking with care connect. Your appointment details:</p>
        <p>Meeting Link will be sent after reviewed by the doctor.</p>
        <p>We look forward to seeing you at your appointment on time!</p>
        <p>Best regards,<br>Care Connect Team</p>
      `;

      sendMail(
        {
          subject: "Your Appointment Booked Successfully",
          message: patientEmailContent,
        },
        booking?.guest?.email
      );

      // Confirmation Email to Doctor
      const doctorEmailContent = `
        <h2>Mr X, New Appointment Booked</h2>
        <p>Booking ID: ${result?.insertedId}</p>
        <p>Transaction ID: ${booking.transactionId}</p>
        <p>New appointment booked with you. Please review the details:</p>
        <p>Meeting Link: <a href="${meetingLink}" target="_blank">${meetingLink}</a></p>
        <p>Be prepared for the appointment and Confirm it before One hour.</p>
        <p>Best regards,<br>Care Connect Team</p>
      `;

      sendMail(
        {
          subject: "New Appointment Booked",
          message: doctorEmailContent,
        },
        booking?.host?.email
      );

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Care Connects Server is running.");
});

app.listen(port, () => {
  console.log(`Care Connect is running on port ${port}`);
});
