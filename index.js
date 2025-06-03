const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// Keep your existing checkout session endpoint for compatibility
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount, listingId, checkIn, checkOut, nights, guests, propertyName, cleaningFee } = req.body;
    
    const actualCleaningFee = cleaningFee || 15000;
    const serviceFee = Math.round(amount * 0.12);
    const taxes = Math.round((amount + actualCleaningFee + serviceFee) * 0.08);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${propertyName || 'Luxury Villa'} - ${nights} night${nights !== 1 ? 's' : ''}`,
              description: `${checkIn} to ${checkOut} • ${guests} guest${guests !== 1 ? 's' : ''}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Cleaning Fee' },
            unit_amount: actualCleaningFee,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Service Fee' },
            unit_amount: serviceFee,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Taxes' },
            unit_amount: taxes,
          },
          quantity: 1,
        },
      ],

      success_url: 'https://your-website.com/success',
      cancel_url: 'https://your-website.com/cancel',
    });

    res.json({ id: session.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// New endpoint for the custom checkout page
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, email, name, phone, booking } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      metadata: {
        customer_email: email,
        customer_name: name,
        customer_phone: phone,
        check_in: booking.checkIn,
        check_out: booking.checkOut,
        nights: booking.nights.toString(),
        guests: booking.guests.toString(),
        base_rate: booking.baseRate.toString(),
        cleaning_fee: booking.cleaningFee.toString()
      }
    });

    res.json({
      client_secret: paymentIntent.client_secret
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
