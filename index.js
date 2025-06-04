const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

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

// New secure payment intent endpoint
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, email, name, phone, booking } = req.body;

    // Server-side validation
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
        cleaning_fee: cleaningFee.toString()
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

// TEST HOSPITABLE RESERVATION CREATION - REMOVE AFTER TESTING
async function testHospitableReservationCreation() {
  const ACCESS_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5YTYyNGRmMC0xMmYxLTQ0OGUtYjg4NC00MzY3ODBhNWQzY2QiLCJqdGkiOiIzMmQ1OGM3MGU5YmY2NWVkYmRmNWVkNGQ0MDc4NDFiZTc0OWFhNTk3Y2VmODQxYjRiYzUyNjI2Y2ExMjJjYTZjMmY1NjJkMWZjM2QwNDQ4NSIsImlhdCI6MTc0NTI3MjAxMi4yMzY4OTMsIm5iZiI6MTc0NTI3MjAxMi4yMzY4OTUsImV4cCI6MTc3NjgwODAxMi4yMzQwNDMsInN1YiI6IjE0NjE4MiIsInNjb3BlcyI6WyJwYXQ6cmVhZCIsInBhdDp3cml0ZSJdfQ.P9V59VrQZpyYUU1MahbTkpVDZ-PfCkHdAE8sOZdKaZN8gby45t5tnzBJG-EeGPUxSHHfpX2DP6ZZQFv4_GLPzEVI_T-4tvtgITYhy-wQceDkcnqT_Zot0FVd06kZHRzFfpsFAkWgAAn6KaVPsN-G5vZJKEaqpk9oMkdcoOwjx6KCfQPluRQpI5-SI5IowQBFTFsqN7Pf2pCFbCv3xZnJ2YABvkL_skIM48e9QLNYKH4fMtebDHLmhmm1hgPUHUwNb8E8cpCOuoyR2AfPWoa-FWAkA_5ipZmAujSoic-VhYiVBCuPAgqzcJdy5EIUqYv3L7WxBqt2cQbTn6tbfv2P-m_1Fe5d0a-9w0BFfyUW0dGeNfe2Z1i3ynQcQXDTn0u5hxdGCgA7lAuTbaIt8gOXObi3cbnnNpCiG_LXewoxXABagHMahoSsjZxO3s4bpkfzLgWSyippTTlRa1Nj33xPvKnHyrdPGO6FSUEmQxAeCd402FZJ-bbKldSpFHSQyJTxjz6msJwS4bROirI_4VqtIlMkSrDUuN-jU4jxQEkj4TRPjB4dPOxHX1XsSWL1uUq8RPNFi7wS7Fz_vUKCfIxHEAsc8Qimz6pJRft0mHS62-_4Xa1Euey4gI9QQuGeozZ2aU6cEpNjtLw6AFxWQl8WXc_R4S0A9pvUXcXHC6MbiOM';
  const LISTING_ID = '869f5e1f-223b-4cc2-b64a-a0f4b8194c82';

  console.log('🧪 TESTING HOSPITABLE RESERVATION CREATION...\n');

  // Test reservation data
  const testReservation = {
    property_id: LISTING_ID,
    check_in_date: '2025-12-15',
    check_out_date: '2025-12-18',
    guest_count: 2,
    guest: {
      first_name: 'Test',
      last_name: 'User',
      email: 'test@example.com',
      phone: '+1234567890'
    },
    guest_name: 'Test User',
    guest_email: 'test@example.com',
    guest_phone: '+1234567890',
    total_amount: 1500,
    base_amount: 1200,
    cleaning_fee: 300,
    currency: 'USD',
    source: 'direct',
    channel: 'website',
    status: 'confirmed',
    confirmation_code: 'TEST' + Date.now(),
    external_id: 'test_' + Date.now(),
    notes: 'TEST BOOKING - DO NOT CHARGE GUEST'
  };

  // Test different endpoint possibilities
  const endpointsToTry = [
    'https://public.api.hospitable.com/v2/reservations',
    `https://public.api.hospitable.com/v2/properties/${LISTING_ID}/reservations`,
    'https://public.api.hospitable.com/v2/bookings',
    `https://public.api.hospitable.com/v2/properties/${LISTING_ID}/bookings`,
    'https://public.api.hospitable.com/v2/external-reservations',
    'https://public.api.hospitable.com/v2/direct-bookings'
  ];

  for (const endpoint of endpointsToTry) {
    console.log(`\n🔍 Testing endpoint: ${endpoint}`);
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(testReservation)
      });

      const responseText = await response.text();
      console.log(`📊 Status: ${response.status}`);
      console.log(`📝 Response: ${responseText.substring(0, 500)}...`);

      if (response.status === 201 || response.status === 200) {
        console.log('\n🎉 SUCCESS! FOUND THE WORKING ENDPOINT!');
        console.log(`✅ Endpoint: ${endpoint}`);
        console.log(`✅ Status: ${response.status}`);
        console.log(`✅ Full Response: ${responseText}`);
        return;
      } else if (response.status === 400) {
        console.log('🤔 400 error - endpoint exists but payload might be wrong');
      } else if (response.status === 404) {
        console.log('❌ 404 - endpoint does not exist');
      } else if (response.status === 401 || response.status === 403) {
        console.log('🔐 Auth error - token might not have permission');
      }

    } catch (error) {
      console.log(`❌ Network error: ${error.message}`);
    }
  }

  console.log('\n📋 TEST COMPLETE - Check results above');
}

// Add test endpoint
app.get('/test-hospitable', async (req, res) => {
  try {
    await testHospitableReservationCreation();
    res.json({ message: 'Test completed - check server logs for results' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
