#![no_std]
use soroban_sdk::{contract, contractimpl, log, token, Address, Env};

#[contract]
pub struct PaymentRouter;

#[contractimpl]
impl PaymentRouter {
    const FEE_BPS: i128 = 40;
    const BPS_DIVISOR: i128 = 10_000;
    const XLM_DECIMALS: i128 = 10_000_000;
    const FEE_CAP_XLM: i128 = 30;
    const FEE_CAP: i128 = Self::FEE_CAP_XLM * Self::XLM_DECIMALS;

    /// Routes a payment from a sender to a recipient, deducting a platform fee.
    ///
    /// The fee is calculated as a percentage (`FEE_BPS` / 10,000) of the `amount`,
    /// capped at `FEE_CAP`. The platform fee is transferred to `platform_treasury`,
    /// and the remaining balance is transferred to `recipient`.
    ///
    /// # Parameters
    /// * `env` - The Soroban environment interface.
    /// * `sender` - The address initiating the payment. Must authorize the transaction.
    /// * `recipient` - The destination address for the payment (e.g., the Anchor's wallet for fiat withdrawals).
    /// * `platform_treasury` - The address where the platform fee will be deposited.
    /// * `token_address` - The contract ID of the token asset being transferred (e.g., NGNC or USDC).
    /// * `amount` - The total amount of tokens to be routed (inclusive of the fee).
    ///
    /// # Return Value
    /// This function does not return a value.
    ///
    /// # Errors
    /// * Fails if `sender.require_auth()` fails (i.e., the sender has not authorized the transaction).
    /// * Fails if the `token_client.transfer` calls fail (e.g., insufficient balance, or invalid token).
    ///
    /// # Events
    /// This function does not emit custom contract events natively via `env.events().publish(...)`, but it
    /// internally logs success messages. The underlying token transfers will emit their respective standard transfer events.
    pub fn route_payment(
        env: Env,
        sender: Address,
        recipient: Address,         // For fiat withdrawals, this is the Anchor's wallet
        platform_treasury: Address,
        token_address: Address,     // The ID of the asset being sent (e.g., NGNC or USDC)
        amount: i128,
    ) {
        // 1. Verify the sender authorized this transaction
        sender.require_auth();

        // 2. Calculate the split
        let mut fee_amount = (amount * Self::FEE_BPS) / Self::BPS_DIVISOR;
        if fee_amount > Self::FEE_CAP {
            fee_amount = Self::FEE_CAP;
        }
        if fee_amount > amount {
            fee_amount = amount;
        }
        let recipient_amount = amount - fee_amount;

        // 3. Initialize the token client for the specific currency
        let token_client = token::Client::new(&env, &token_address);

        // 4. Transfer the platform fee to your treasury
        // The client moves funds directly from the sender to the treasury
        token_client.transfer(&sender, &platform_treasury, &fee_amount);

        // 5. Transfer the remaining balance to the recipient (the Anchor)
        token_client.transfer(&sender, &recipient, &recipient_amount);

        // 6. Log success for testing
        log!(&env, "Platform fee routed to treasury");
        log!(&env, "Remaining balance routed to Anchor");
    }
}