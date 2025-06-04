const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());
app.use('/webhook', express.raw({type: 'application/json'}));

// In-memory storage for bookings by property
let bookingsByProperty = {};

// Property IDs (add all your properties here)
const PROPERTIES = {
  'cos1': '869f5e1f-223b-4cc2-b64a-a0f4b8194c82', // Colorado Springs
  'vegas1': 'your-vegas-property-id',
  'miami1': 'your-miami-property-id'
  // Add more properties as needed
};

// Keep existing checkout session endpoint
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

// Payment intent endpoint with property ID
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, email, name, phone, booking, propertyId } = req.body;
    
    const { checkInDate, checkOutDate, nights, baseRate, cleaningFee } = booking;
    
    // Validate dates
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const calculatedNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    
    if (calculatedNights !== nights) {
      return res.status(400).json({ error: 'Invalid booking dates' });
    }
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      metadata: {
        customer_email: email,
        customer_name: name,
        customer_phone: phone,
        check_in: checkInDate,
        check_out: checkOutDate,
        nights: nights.toString(),
        guests: booking.guests.toString(),
        base_rate: baseRate.toString(),
        cleaning_fee: cleaningFee.toString(),
        property_id: propertyId || 'cos1' // Default to Colorado Springs
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

// Property-specific iCal endpoints
app.get('/calendar/:propertyId.ics', (req, res) => {
  const propertyId = req.params.propertyId;
  const propertyBookings = bookingsByProperty[propertyId] || [];
  
  let icalContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//HRZN//Direct Bookings ${propertyId.toUpperCase()}//EN`;

  propertyBookings.forEach(booking => {
    const checkInDate = new Date(booking.checkIn).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const checkOutDate = new Date(booking.checkOut).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    icalContent += `
BEGIN:VEVENT
UID:${booking.id}@hrzn.com
DTSTART:${checkInDate}
DTEND:${checkOutDate}
SUMMARY:${booking.guestName} - Direct Booking
DESCRIPTION:Guest: ${booking.guestName}\\nEmail: ${booking.email}\\nPhone: ${booking.phone}\\nGuests: ${booking.guests}\\nTotal: $${booking.total}\\nPayment ID: ${booking.paymentId}\\nSource: HRZN Website
LOCATION:${booking.propertyName}
END:VEVENT`;
  });

  icalContent += `
END:VCALENDAR`;

  res.setHeader('Content-Type', 'text/calendar');
  res.send(icalContent);
});

// Webhook to handle successful payments
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    
    console.log('💰 Payment succeeded, creating booking...');
    
    const propertyId = paymentIntent.metadata.property_id || 'cos1';
    
    // Create booking object
    const booking = {
      id: paymentIntent.id,
      paymentId: paymentIntent.id,
      guestName: paymentIntent.metadata.customer_name,
      email: paymentIntent.metadata.customer_email,
      phone: paymentIntent.metadata.customer_phone,
      checkIn: paymentIntent.metadata.check_in,
      checkOut: paymentIntent.metadata.check_out,
      nights: parseInt(paymentIntent.metadata.nights),
      guests: parseInt(paymentIntent.metadata.guests),
      total: (parseInt(paymentIntent.metadata.base_rate) * parseInt(paymentIntent.metadata.nights)) + parseInt(paymentIntent.metadata.cleaning_fee),
      propertyId: propertyId,
      propertyName: getPropertyName(propertyId),
      createdAt: new Date().toISOString()
    };

    // Initialize property array if doesn't exist
    if (!bookingsByProperty[propertyId]) {
      bookingsByProperty[propertyId] = [];
    }

    // Add booking to property-specific array
    bookingsByProperty[propertyId].push(booking);
    
    console.log(`✅ Booking created for property ${propertyId}:`, booking);
    console.log(`📊 Total bookings for ${propertyId}:`, bookingsByProperty[propertyId].length);
  }

  res.json({received: true});
});

// Helper function to get property name
function getPropertyName(propertyId) {
  const names = {
    'cos1': 'Colorado Springs Retreat',
    'vegas1': 'Vegas Villa',
    'miami1': 'Miami Beach House'
  };
  return names[propertyId] || 'HRZN Property';
}

// Debug endpoint to view bookings by property
app.get('/bookings/:propertyId?', (req, res) => {
  const propertyId = req.params.propertyId;
  
  if (propertyId) {
    res.json({
      property: propertyId,
      bookings: bookingsByProperty[propertyId] || []
    });
  } else {
    res.json(bookingsByProperty);
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
