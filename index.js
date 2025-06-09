const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use('/webhook', express.raw({type: 'application/json'}));
app.use(express.json());

// ERROR ALERT FUNCTION - ADDED
async function emailError(errorType, errorDetails) {
  try {
    const response = await fetch('https://a.klaviyo.com/api/events/', {
      method: 'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
        'Content-Type': 'application/json',
        'revision': '2024-10-15'
      },
      body: JSON.stringify({
        data: {
          type: "event",
          attributes: {
            profile: {
              data: {
                type: "profile",
                attributes: {
                  email: "ronitlodd@gmail.com"
                }
              }
            },
            metric: {
              data: {
                type: "metric",
                attributes: {
                  name: "System Error Alert"
                }
              }
            },
            properties: {
              error_type: errorType,
              timestamp: new Date().toISOString(),
              ...errorDetails
            }
          }
        }
      })
    });

    if (response.ok) {
      console.log('📧 Error alert sent to Klaviyo successfully');
    } else {
      console.error('❌ Failed to send error alert to Klaviyo:', await response.text());
    }
  } catch (e) {
    console.log('❌ Failed to send error alert to Klaviyo:', e.message);
  }
}

// File path for persistent storage
const BOOKINGS_FILE = path.join(__dirname, 'bookings.json');

// Load bookings from file on startup
let bookingsByProperty = {};

function loadBookings() {
  try {
    if (fs.existsSync(BOOKINGS_FILE)) {
      const data = fs.readFileSync(BOOKINGS_FILE, 'utf8');
      bookingsByProperty = JSON.parse(data);
      console.log('📚 Loaded existing bookings from file');
    } else {
      console.log('📚 No existing bookings file found, starting fresh');
    }
  } catch (error) {
    console.error('❌ Error loading bookings:', error);
    emailError('FILE_LOAD_FAILED', {
      error: error.message,
      file: BOOKINGS_FILE
    });
    bookingsByProperty = {};
  }
}

function saveBookings() {
  try {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookingsByProperty, null, 2));
    console.log('💾 Bookings saved to file');
  } catch (error) {
    console.error('❌ Error saving bookings:', error);
    emailError('FILE_SAVE_FAILED', {
      error: error.message,
      file: BOOKINGS_FILE
    });
  }
}

// Load bookings on startup
loadBookings();

// AUTO-DETECT PROPERTIES - Map Hospitable Listing IDs to Property Codes
const PROPERTY_MAP = {
  '869f5e1f-223b-4cc2-b64a-a0f4b8194c82': { // Colorado Springs (your current one)
    code: 'cos1',
    name: 'Colorado Springs Retreat'
  },
  'your-vegas-listing-id': {
    code: 'vegas1', 
    name: 'Vegas Villa'
  },
  'your-miami-listing-id': {
    code: 'miami1',
    name: 'Miami Beach House'
  },
  'your-austin-listing-id': {
    code: 'austin1',
    name: 'Austin Downtown Loft'
  },
  'your-denver-listing-id': {
    code: 'denver1',
    name: 'Denver Mountain Lodge'
  },
  'your-phoenix-listing-id': {
    code: 'phoenix1',
    name: 'Phoenix Desert Villa'
  }
};

// Date parsing function to convert "Dec 10" to proper dates
function parseTextDate(dateText) {
  const date = new Date(`${dateText} 2025`);
  if (isNaN(date.getTime()) || date < new Date()) {
    const futureDate = new Date(`${dateText} 2026`);
    return futureDate.toISOString().split('T')[0];
  }
  return date.toISOString().split('T')[0];
}

// Keep existing checkout session endpoint
app.post('/create-checkout-session', async (req, res) => {
    console.log('🚀 ENDPOINT HIT - Request received');
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
    emailError('STRIPE_CHECKOUT_SESSION_FAILED', {
      error: error.message,
      amount: amount,
      listing_id: listingId,
      check_in: checkIn,
      check_out: checkOut
    });
    res.status(500).json({ error: error.message });
  }
});

// Payment intent endpoint - AUTO-DETECTS PROPERTY FROM LISTING_ID
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, email, name, phone, booking } = req.body;
    
    const { checkIn: checkInDate, checkOut: checkOutDate, nights, baseRate, cleaningFee } = booking;

    // ADD THESE DEBUG LINES HERE:
    console.log('🔍 Full request body:', req.body);
    console.log('🔍 Booking data received:', booking);
    console.log('🔍 CheckIn:', checkInDate, 'CheckOut:', checkOutDate);
    console.log('🔍 Amount:', amount, 'Nights:', nights);
    
    // Validate dates
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const calculatedNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    
    if (calculatedNights !== nights) {
      return res.status(400).json({ error: 'Invalid booking dates' });
    }
    
    // AUTO-DETECT PROPERTY - Get LISTING_ID from your booking widget
    const listingId = booking.listingId || '869f5e1f-223b-4cc2-b64a-a0f4b8194c82'; // Default to Colorado Springs
    const property = PROPERTY_MAP[listingId];
    
    console.log('🏠 Detected property:', listingId, '→', property ? property.name : 'Unknown');
    
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
        listing_id: listingId,
        property_code: property ? property.code : 'cos1'
      }
    });
    
    res.json({
      client_secret: paymentIntent.client_secret
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    emailError('STRIPE_PAYMENT_INTENT_FAILED', {
      error: error.message,
      user_email: email,
      user_name: name,
      amount: amount,
      check_in: booking.checkIn,
      check_out: booking.checkOut,
      listing_id: booking.listingId
    });
    res.status(500).json({ error: error.message });
  }
});

// Property-specific iCal endpoints for ALL PROPERTIES
app.get('/calendar/:propertyCode.ics', (req, res) => {
  try {
    const propertyCode = req.params.propertyCode;
    const propertyBookings = bookingsByProperty[propertyCode] || [];
    
    let icalContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//HRZN//Direct Bookings ${propertyCode.toUpperCase()}//EN`;

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
  } catch (error) {
    emailError('CALENDAR_GENERATION_FAILED', {
      error: error.message,
      property_code: req.params.propertyCode
    });
    res.status(500).json({ error: 'Failed to generate calendar' });
  }
});

// Delete booking endpoint - PROTECTED with password
app.delete('/bookings/:propertyCode/:bookingId', (req, res) => {
  try {
    // Check for admin password
    const authPassword = req.headers['x-admin-password'];
    if (!authPassword || authPassword !== process.env.ADMIN_PASSWORD) {
      console.log('🚫 Unauthorized delete attempt');
      return res.status(401).json({ error: 'Unauthorized - Admin password required' });
    }
    
    const { propertyCode, bookingId } = req.params;
    
    if (!bookingsByProperty[propertyCode]) {
      return res.status(404).json({ error: 'Property not found' });
    }
    
    const bookingIndex = bookingsByProperty[propertyCode].findIndex(
      booking => booking.id === bookingId
    );
    
    if (bookingIndex === -1) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Remove the booking
    const deletedBooking = bookingsByProperty[propertyCode].splice(bookingIndex, 1)[0];
    
    // Save to file
    saveBookings();
    
    console.log(`🗑️ Admin deleted booking: ${deletedBooking.guestName} (${deletedBooking.id})`);
    
    res.json({ 
      message: 'Booking deleted successfully',
      deletedBooking: deletedBooking,
      remainingBookings: bookingsByProperty[propertyCode].length
    });
  } catch (error) {
    emailError('BOOKING_DELETE_FAILED', {
      error: error.message,
      property_code: req.params.propertyCode,
      booking_id: req.params.bookingId
    });
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// Webhook - AUTO-CREATES BOOKINGS BY PROPERTY
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed:`, err.message);
    emailError('WEBHOOK_SIGNATURE_FAILED', {
      error: err.message,
      headers: req.headers
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    
    console.log('💰 Payment succeeded, creating booking...');
    
    // Get property info from metadata
    const listingId = paymentIntent.metadata.listing_id || '869f5e1f-223b-4cc2-b64a-a0f4b8194c82';
    const propertyCode = paymentIntent.metadata.property_code || 'cos1';
    const property = PROPERTY_MAP[listingId];
    
    const booking = {
      id: paymentIntent.id,
      paymentId: paymentIntent.id,
      guestName: paymentIntent.metadata.customer_name,
      email: paymentIntent.metadata.customer_email,
      phone: paymentIntent.metadata.customer_phone,
      checkIn: parseTextDate(paymentIntent.metadata.check_in),
      checkOut: parseTextDate(paymentIntent.metadata.check_out),
      nights: parseInt(paymentIntent.metadata.nights),
      guests: parseInt(paymentIntent.metadata.guests),
      total: (parseInt(paymentIntent.metadata.base_rate) * parseInt(paymentIntent.metadata.nights)) + parseInt(paymentIntent.metadata.cleaning_fee),
      propertyCode: propertyCode,
      propertyName: property ? property.name : 'HRZN Property',
      listingId: listingId,
      createdAt: new Date().toISOString()
    };

    // Initialize property array if doesn't exist
    if (!bookingsByProperty[propertyCode]) {
      bookingsByProperty[propertyCode] = [];
    }

    try {
      bookingsByProperty[propertyCode].push(booking);
      
      // Save to file after adding booking
      saveBookings();
      
      console.log(`✅ Booking created for ${property ? property.name : 'Unknown Property'}:`, booking);
    } catch (error) {
      emailError('BOOKING_CREATION_FAILED', {
        error: error.message,
        payment_id: paymentIntent.id,
        guest_name: paymentIntent.metadata.customer_name,
        guest_email: paymentIntent.metadata.customer_email,
        property_code: propertyCode
      });
      console.error('❌ Failed to create booking:', error);
    }
    
    // Send booking notification to Klaviyo
try {
  const response = await fetch('https://a.klaviyo.com/api/events/', {
    method: 'POST',
    headers: {
      'Authorization': `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
      'Content-Type': 'application/json',
      'revision': '2024-10-15'
    },
    body: JSON.stringify({
      data: {
        type: "event",
        attributes: {
          profile: {
            data: {
              type: "profile",
              attributes: {
                email: "ronitlodd@gmail.com"
              }
            }
          },
          metric: {
            data: {
              type: "metric",
              attributes: {
                name: "New Booking Alert"
              }
            }
          },
          properties: {
            guest_name: booking.guestName,
            guest_email: booking.email,
            guest_phone: booking.phone,
            check_in: booking.checkIn,
            check_out: booking.checkOut,
            nights: booking.nights,
            guests: booking.guests,
            total_amount: booking.total,
            property_name: booking.propertyName,
            property_code: booking.propertyCode,
            listing_id: booking.listingId,
            payment_id: booking.paymentId,
            booking_id: booking.id,
            created_at: booking.createdAt
          }
        }
      }
    })
  });

  if (response.ok) {
    console.log('📧 Booking notification sent to Klaviyo successfully');
  } else {
    console.error('❌ Failed to send to Klaviyo:', await response.text());
  }
} catch (error) {
  console.error('❌ Error sending booking notification:', error);
  emailError('KLAVIYO_NOTIFICATION_FAILED', {
    error: error.message,
    guest_name: booking.guestName,
    guest_email: booking.email,
    booking_id: booking.id
  });
}
    console.log(`📊 Total bookings for ${propertyCode}:`, bookingsByProperty[propertyCode].length);
  }

  res.json({received: true});
});

// Debug endpoint to view all bookings
app.get('/bookings/:propertyCode?', (req, res) => {
  const propertyCode = req.params.propertyCode;
  
  if (propertyCode) {
    res.json({
      property: propertyCode,
      bookings: bookingsByProperty[propertyCode] || []
    });
  } else {
    res.json(bookingsByProperty);
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
